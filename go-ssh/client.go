package main

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// ConnConfig 描述一次 SSH 連線所需的全部資訊（與前端 ConnectionConfig 對應）。
type ConnConfig struct {
	Host            string
	Port            int
	Username        string
	AuthType        string // "password" | "privateKey"
	Password        string
	PrivateKey      string
	Passphrase      string
	HostKeyVerifier HostKeyVerifier
}

// connectTimeout：TCP 連線逾時。
const connectTimeout = 15 * time.Second

// Dialer 建立底層連線的函式型別；瀏覽器端以 WebSocket 通道實作。
type Dialer func(network, addr string) (net.Conn, error)

// HostKeyVerifier 驗證伺服器 host key。回傳錯誤即拒絕 SSH 握手。
type HostKeyVerifier func(hostname, keyType, fingerprint string) error

// defaultDialer 原生環境的直接 TCP 撥接。
func defaultDialer(network, addr string) (net.Conn, error) {
	d := net.Dialer{Timeout: connectTimeout}
	return d.Dial(network, addr)
}

// DialClient 建立 SSH 連線並完成認證（原生 TCP 撥接）。
func DialClient(cfg ConnConfig) (*gossh.Client, error) {
	return DialClientWithDialer(cfg, defaultDialer)
}

// DialClientWithDialer 以自訂撥接函式建立 SSH 連線並完成認證。
// 瀏覽器端傳入以 WebSocket 為傳輸層的 Dialer（見 wsconn.go）。
func DialClientWithDialer(cfg ConnConfig, dial Dialer) (*gossh.Client, error) {
	var authMethods []gossh.AuthMethod

	switch cfg.AuthType {
	case "password":
		if cfg.Password == "" {
			return nil, errors.New("密碼認證需要提供 password")
		}
		authMethods = append(authMethods, gossh.Password(cfg.Password))
	case "privateKey":
		if cfg.PrivateKey == "" {
			return nil, errors.New("私鑰認證需要提供 privateKey")
		}
		var signer gossh.Signer
		var err error
		if cfg.Passphrase != "" {
			signer, err = gossh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = gossh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("解析私鑰失敗：%w", err)
		}
		authMethods = append(authMethods, gossh.PublicKeys(signer))
	default:
		return nil, fmt.Errorf("不支援的認證類型：%q", cfg.AuthType)
	}
	if cfg.HostKeyVerifier == nil {
		return nil, errors.New("SSH host key verifier 未設定，拒絕連線")
	}

	clientConfig := &gossh.ClientConfig{
		User: cfg.Username,
		Auth: authMethods,
		HostKeyCallback: func(hostname string, _ net.Addr, key gossh.PublicKey) error {
			return cfg.HostKeyVerifier(
				hostname,
				key.Type(),
				gossh.FingerprintSHA256(key),
			)
		},
		Timeout: connectTimeout,
	}
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	conn, err := dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := gossh.NewClientConn(conn, addr, clientConfig)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return gossh.NewClient(c, chans, reqs), nil
}
