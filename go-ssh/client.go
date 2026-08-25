package main

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// SshOption 與前端 shared 白名單（src/shared/ssh-options.ts）一一對應。
type SshOption struct {
	Key   string
	Value string
}

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
	SshOptions      []SshOption
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
// 回傳的 stop 可停止內建 keepalive（未啟用時為 no-op）。
func DialClient(cfg ConnConfig) (*gossh.Client, func(), error) {
	return DialClientWithDialer(cfg, nil)
}

// normalizeHost 正規化主機位址：接受裸 IPv6（"::1"）與帶方括號（"[::1]"），
// 回傳 net.JoinHostPort 可直接使用的形式（括號一律移除）。IPv4 與域名原樣保留。
// 與 Worker 端 normalizeSshHostname（src/worker/ssh-host.ts）語意一致。
func normalizeHost(host string) string {
	h := strings.TrimSpace(host)
	if len(h) >= 2 && strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]") {
		inner := h[1 : len(h)-1]
		if inner != "" && !strings.ContainsAny(inner, "[]") {
			return inner
		}
	}
	return h
}

// splitOptionList 把逗號清單切成非空 token（對應 ssh_config 的清單語意）。
func splitOptionList(value string) []string {
	raw := strings.Split(value, ",")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if token := strings.TrimSpace(item); token != "" {
			out = append(out, token)
		}
	}
	return out
}

// applySshOptions 把白名單 -o 選項映射到 ClientConfig。
// 鍵大小寫不敏感；未知鍵（如 ProxyCommand，由 Worker 端 Access 通道處理）安靜忽略。
func applySshOptions(opts []SshOption, cc *gossh.ClientConfig, defaultTimeout time.Duration) {
	cc.Timeout = defaultTimeout
	for _, opt := range opts {
		switch strings.ToLower(strings.TrimSpace(opt.Key)) {
		case "ciphers":
			cc.Config.Ciphers = splitOptionList(opt.Value)
		case "macs":
			cc.Config.MACs = splitOptionList(opt.Value)
		case "kexalgorithms":
			cc.Config.KeyExchanges = splitOptionList(opt.Value)
		case "hostkeyalgorithms":
			cc.HostKeyAlgorithms = splitOptionList(opt.Value)
		case "connecttimeout":
			if n, err := strconv.Atoi(strings.TrimSpace(opt.Value)); err == nil && n > 0 {
				cc.Timeout = time.Duration(n) * time.Second
			}
		}
	}
}

// keepaliveSettings 描述 keepalive 週期行為（對應 ServerAlive* 選項）。
type keepaliveSettings struct {
	interval    time.Duration
	maxFailures int
}

// keepaliveFromOptions 從選項解析 keepalive 設定。
// 僅 ServerAliveInterval>0 啟用；CountMax 缺省為 3（OpenSSH 預設）。
func keepaliveFromOptions(opts []SshOption) (keepaliveSettings, bool) {
	interval := 0
	maxFailures := 3
	for _, opt := range opts {
		switch strings.ToLower(strings.TrimSpace(opt.Key)) {
		case "serveraliveinterval":
			if n, err := strconv.Atoi(strings.TrimSpace(opt.Value)); err == nil {
				interval = n
			}
		case "serveralivecountmax":
			if n, err := strconv.Atoi(strings.TrimSpace(opt.Value)); err == nil && n > 0 {
				maxFailures = n
			}
		}
	}
	if interval <= 0 {
		return keepaliveSettings{}, false
	}
	return keepaliveSettings{
		interval:    time.Duration(interval) * time.Second,
		maxFailures: maxFailures,
	}, true
}

// goKeepalive 週期發送 keepalive@openssh.com global request；
// 連續失敗達 maxFailures 次關閉連線。回傳 stop 停止 goroutine。
func goKeepalive(client *gossh.Client, settings keepaliveSettings) func() {
	done := make(chan struct{})
	go func() {
		failures := 0
		ticker := time.NewTicker(settings.interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
				if err != nil {
					failures++
					if failures >= settings.maxFailures {
						_ = client.Close()
						return
					}
					continue
				}
				failures = 0
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(done) }) }
}

// DialClientWithDialer 以自訂撥接函式建立 SSH 連線並完成認證。
// dial 為 nil 時使用原生 TCP；瀏覽器端傳入以 WebSocket 為傳輸層的 Dialer（見 wsconn.go）。
// 回傳的 stop 可停止內建 keepalive（未啟用時為 no-op），呼叫端於連線關閉時應叫用它。
func DialClientWithDialer(cfg ConnConfig, dial Dialer) (*gossh.Client, func(), error) {
	var authMethods []gossh.AuthMethod

	switch cfg.AuthType {
	case "password":
		if cfg.Password == "" {
			return nil, nil, errors.New("密碼認證需要提供 password")
		}
		authMethods = append(authMethods, gossh.Password(cfg.Password))
	case "privateKey":
		if cfg.PrivateKey == "" {
			return nil, nil, errors.New("私鑰認證需要提供 privateKey")
		}
		var signer gossh.Signer
		var err error
		if cfg.Passphrase != "" {
			signer, err = gossh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = gossh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, nil, fmt.Errorf("解析私鑰失敗：%w", err)
		}
		authMethods = append(authMethods, gossh.PublicKeys(signer))
	default:
		return nil, nil, fmt.Errorf("不支援的認證類型：%q", cfg.AuthType)
	}
	if cfg.HostKeyVerifier == nil {
		return nil, nil, errors.New("SSH host key verifier 未設定，拒絕連線")
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
	}
	applySshOptions(cfg.SshOptions, clientConfig, connectTimeout)

	if dial == nil {
		dial = defaultDialer
	}
	addr := net.JoinHostPort(normalizeHost(cfg.Host), strconv.Itoa(cfg.Port))
	conn, err := dial("tcp", addr)
	if err != nil {
		return nil, nil, err
	}
	c, chans, reqs, err := gossh.NewClientConn(conn, addr, clientConfig)
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	client := gossh.NewClient(c, chans, reqs)
	if ka, ok := keepaliveFromOptions(cfg.SshOptions); ok {
		return client, goKeepalive(client, ka), nil
	}
	return client, func() {}, nil
}
