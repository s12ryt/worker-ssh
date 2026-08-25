package main

// 測試基礎設施：in-process SSH 伺服器。
// - 密碼認證：tester / secret-pass
// - 公鑰認證：動態生成的 ed25519 金鑰
// - exec：fake 協議（見 fakeExec），完全決定性且跨平台
// - shell：回顯模式（stdin → stdout）
// - subsystem sftp：github.com/pkg/sftp 真實伺服器，根目錄 = t.TempDir()

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

const (
	testUser      = "tester"
	testPassword  = "secret-pass"
	keyPassphrase = "key-pass-123"
)

type testServer struct {
	addr               string
	hostKeyType        string
	hostKeyFingerprint string
	privatePEM         []byte // 未加密私鑰 PEM（openssh 格式）
	encPEM             []byte // passphrase 加密私鑰 PEM（openssh 格式）
	passphrase         string
	rootDir            string
	mu                 sync.Mutex
	openConns          []net.Conn
	keepaliveCount     atomic.Int64
}

// KeepaliveCount 回傳收到的 keepalive@openssh.com global request 次數。
func (ts *testServer) KeepaliveCount() int {
	return int(ts.keepaliveCount.Load())
}

// serveGlobalRequests 處理連線層 global request：keepalive 計數並回覆成功，
// 其餘要求回覆失敗（等同 gossh.DiscardRequests 的 Reply(false) 行為）。
func (ts *testServer) serveGlobalRequests(reqs <-chan *gossh.Request) {
	for req := range reqs {
		if req.Type == "keepalive@openssh.com" {
			ts.keepaliveCount.Add(1)
			if req.WantReply {
				req.Reply(true, nil)
			}
			continue
		}
		if req.WantReply {
			req.Reply(false, nil)
		}
	}
}

func startTestServer(t *testing.T) *testServer {
	t.Helper()
	return startTestServerOn(t, "127.0.0.1:0")
}

// startTestServerOn 在指定位址啟動測試伺服器（例如 "[::1]:0" 驗證 IPv6）。
func startTestServerOn(t *testing.T, listenAddr string) *testServer {
	t.Helper()

	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成 host key：%v", err)
	}
	hostSigner, err := gossh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("host signer：%v", err)
	}

	_, userPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成 user key：%v", err)
	}
	plainBlock, err := gossh.MarshalPrivateKey(userPriv, "worker-ssh-test")
	if err != nil {
		t.Fatalf("序列化測試私鑰：%v", err)
	}
	encryptedBlock, err := gossh.MarshalPrivateKeyWithPassphrase(
		userPriv,
		"worker-ssh-test",
		[]byte(keyPassphrase),
	)
	if err != nil {
		t.Fatalf("加密測試私鑰：%v", err)
	}
	privatePEM := pem.EncodeToMemory(plainBlock)
	encryptedPEM := pem.EncodeToMemory(encryptedBlock)
	userSigner, err := gossh.ParsePrivateKey(privatePEM)
	if err != nil {
		t.Fatalf("解析測試私鑰：%v", err)
	}
	encSigner, err := gossh.ParsePrivateKeyWithPassphrase(encryptedPEM, []byte(keyPassphrase))
	if err != nil {
		t.Fatalf("解析加密測試私鑰：%v", err)
	}
	acceptedPubKeys := map[string]bool{
		string(userSigner.PublicKey().Marshal()): true,
		string(encSigner.PublicKey().Marshal()):  true,
	}

	root := t.TempDir()
	ts := &testServer{
		hostKeyType:        hostSigner.PublicKey().Type(),
		hostKeyFingerprint: gossh.FingerprintSHA256(hostSigner.PublicKey()),
		privatePEM:         privatePEM,
		encPEM:             encryptedPEM,
		passphrase:         keyPassphrase,
		rootDir:            root,
	}

	cfg := &gossh.ServerConfig{
		PasswordCallback: func(m gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			if m.User() == testUser && string(password) == testPassword {
				return &gossh.Permissions{}, nil
			}
			return nil, fmt.Errorf("密碼認證失敗：%q", m.User())
		},
		PublicKeyCallback: func(m gossh.ConnMetadata, key gossh.PublicKey) (*gossh.Permissions, error) {
			if m.User() == testUser && acceptedPubKeys[string(key.Marshal())] {
				return &gossh.Permissions{}, nil
			}
			return nil, fmt.Errorf("公鑰認證失敗：%q", m.User())
		},
	}
	cfg.AddHostKey(hostSigner)

	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		t.Fatalf("監聽失敗：%v", err)
	}
	ts.addr = ln.Addr().String()

	t.Cleanup(func() {
		ln.Close()
		ts.mu.Lock()
		for _, c := range ts.openConns {
			c.Close()
		}
		ts.mu.Unlock()
	})

	go ts.acceptLoop(ln, cfg)
	return ts
}

func trustTestServer(ts *testServer) HostKeyVerifier {
	return func(_ string, keyType string, fingerprint string) error {
		if keyType != ts.hostKeyType || fingerprint != ts.hostKeyFingerprint {
			return fmt.Errorf("測試 host key 不符：%s %s", keyType, fingerprint)
		}
		return nil
	}
}

func (ts *testServer) track(c net.Conn) {
	ts.mu.Lock()
	ts.openConns = append(ts.openConns, c)
	ts.mu.Unlock()
}

func (ts *testServer) acceptLoop(ln net.Listener, cfg *gossh.ServerConfig) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		ts.track(c)
		go ts.handleConn(c, cfg)
	}
}

func (ts *testServer) handleConn(c net.Conn, cfg *gossh.ServerConfig) {
	sconn, chans, reqs, err := gossh.NewServerConn(c, cfg)
	if err != nil {
		c.Close() // 認證失敗屬正常流程
		return
	}
	defer sconn.Close()
	go ts.serveGlobalRequests(reqs)
	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			newChan.Reject(gossh.UnknownChannelType, "僅支援 session")
			continue
		}
		ch, chReqs, err := newChan.Accept()
		if err != nil {
			continue
		}
		go ts.handleSession(ch, chReqs)
	}
}

func (ts *testServer) handleSession(ch gossh.Channel, reqs <-chan *gossh.Request) {
	var wg sync.WaitGroup
	defer wg.Wait()
	for req := range reqs {
		switch req.Type {
		case "exec":
			cmd := parseRequestString(req.Payload)
			req.Reply(true, nil)
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer ch.Close()
				stdoutText, stderrText, code := fakeExec(cmd)
				if stdoutText != "" {
					ch.Write([]byte(stdoutText))
				}
				if stderrText != "" {
					ch.Stderr().Write([]byte(stderrText))
				}
				sendExitStatus(ch, code)
			}()
		case "shell":
			req.Reply(true, nil)
			wg.Add(1)
			go func() {
				defer wg.Done()
				echoLoop(ch)
			}()
		case "pty-req":
			req.Reply(true, nil)
		case "subsystem":
			name := parseRequestString(req.Payload)
			if name == "sftp" {
				req.Reply(true, nil)
				srv, err := sftp.NewServer(ch)
				if err != nil {
					ch.Close()
					continue
				}
				wg.Add(1)
				go func() {
					defer wg.Done()
					_ = srv.Serve() // 回傳 io.EOF 表示通道關閉
					srv.Close()
				}()
			} else {
				req.Reply(false, nil)
			}
		default:
			if req.WantReply {
				req.Reply(false, nil)
			}
		}
	}
}

// parseRequestString 解析 SSH request payload：前 4 byte 為長度前綴的字串。
func parseRequestString(payload []byte) string {
	if len(payload) < 4 {
		return ""
	}
	n := binary.BigEndian.Uint32(payload[:4])
	if int(n) > len(payload)-4 {
		n = uint32(len(payload) - 4)
	}
	return string(payload[4 : 4+n])
}

func sendExitStatus(ch gossh.Channel, code int) {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload, uint32(code))
	_, _ = ch.SendRequest("exit-status", false, payload)
}

func echoLoop(ch gossh.Channel) {
	buf := make([]byte, 4096)
	for {
		n, err := ch.Read(buf)
		if n > 0 {
			if _, werr := ch.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// fakeExec 決定性執行協議：
//
//	out:<text>      → stdout=text, exit 0
//	err:<text>      → stderr=text, exit 0
//	code:<n>        → exit n
//	fail:<n>:<msg>  → stderr=msg, exit n
//	both:<a>|<b>    → stdout=a, stderr=b, exit 0
//	其他            → stderr="unknown command", exit 127
func fakeExec(cmd string) (stdout, stderr string, exitCode int) {
	switch {
	case strings.HasPrefix(cmd, "out:"):
		return cmd[len("out:"):], "", 0
	case strings.HasPrefix(cmd, "err:"):
		return "", cmd[len("err:"):], 0
	case strings.HasPrefix(cmd, "code:"):
		n, err := strconv.Atoi(cmd[len("code:"):])
		if err != nil {
			return "", "bad code", 2
		}
		return "", "", n
	case strings.HasPrefix(cmd, "fail:"):
		rest := cmd[len("fail:"):]
		idx := strings.Index(rest, ":")
		if idx < 0 {
			return "", "bad fail spec", 2
		}
		n, err := strconv.Atoi(rest[:idx])
		if err != nil {
			return "", "bad fail code", 2
		}
		return "", rest[idx+1:], n
	case strings.HasPrefix(cmd, "both:"):
		parts := strings.SplitN(cmd[len("both:"):], "|", 2)
		if len(parts) != 2 {
			return "", "bad both spec", 2
		}
		return parts[0], parts[1], 0
	default:
		return "", "unknown command", 127
	}
}
