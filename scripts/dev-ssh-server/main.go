// 本地 E2E 測試用 SSH 伺服器（獨立行程，非正式產品碼）。
// 改編自 go-ssh/testserver_test.go 的 in-process 測試伺服器：
//   - 密碼認證：tester / secret-pass
//   - exec：偵測 os-release、監控標記指令回傳合成輸出，其餘回顯
//   - shell：橫幅＋回顯
//   - subsystem sftp：真實 SFTP 伺服器，根目錄為啟動時建立的暫存目錄
//
// 執行：go run ./scripts/dev-ssh-server（監聽 127.0.0.1:2222）
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

const (
	listenAddr = "127.0.0.1:2222"
	testUser   = "tester"
	testPass   = "secret-pass"
)

func main() {
	root, err := os.MkdirTemp("", "dev-ssh-sftp-*")
	if err != nil {
		log.Fatalf("建立 SFTP 根目錄：%v", err)
	}
	seedSftpRoot(root)
	log.Printf("SFTP 根目錄：%s", root)
	// pkg/sftp 伺服器以行程 cwd 解析相對路徑；切換過去使「/」即根目錄
	if err := os.Chdir(root); err != nil {
		log.Fatalf("切換工作目錄：%v", err)
	}

	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("host key：%v", err)
	}
	hostSigner, err := gossh.NewSignerFromKey(hostPriv)
	if err != nil {
		log.Fatalf("host signer：%v", err)
	}

	cfg := &gossh.ServerConfig{
		PasswordCallback: func(m gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			if m.User() == testUser && string(password) == testPass {
				return &gossh.Permissions{}, nil
			}
			return nil, fmt.Errorf("密碼認證失敗：%q", m.User())
		},
	}
	cfg.AddHostKey(hostSigner)

	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("監聽 %s：%v", listenAddr, err)
	}
	log.Printf("dev-ssh-server 監聽 %s（帳號 %s / %s）", listenAddr, testUser, testPass)
	for {
		c, err := ln.Accept()
		if err != nil {
			log.Fatalf("accept：%v", err)
		}
		go handleConn(c, cfg, root)
	}
}

func handleConn(c net.Conn, cfg *gossh.ServerConfig, root string) {
	sconn, chans, reqs, err := gossh.NewServerConn(c, cfg)
	if err != nil {
		c.Close() // 認證失敗屬正常流程
		return
	}
	defer sconn.Close()
	go gossh.DiscardRequests(reqs)
	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			newChan.Reject(gossh.UnknownChannelType, "僅支援 session")
			continue
		}
		ch, chReqs, err := newChan.Accept()
		if err != nil {
			continue
		}
		go handleSession(ch, chReqs, root)
	}
}

func handleSession(ch gossh.Channel, reqs <-chan *gossh.Request, root string) {
	for req := range reqs {
		switch req.Type {
		case "exec":
			cmd := parseRequestString(req.Payload)
			req.Reply(true, nil)
			stdoutText, stderrText, code := fakeExec(cmd)
			if stdoutText != "" {
				ch.Write([]byte(stdoutText))
			}
			if stderrText != "" {
				ch.Stderr().Write([]byte(stderrText))
			}
			sendExitStatus(ch, code)
			ch.Close()
		case "shell":
			req.Reply(true, nil)
			go echoShell(ch)
		case "pty-req":
			req.Reply(true, nil)
		case "subsystem":
			if parseRequestString(req.Payload) == "sftp" {
				req.Reply(true, nil)
				srv, err := sftp.NewServer(ch)
				if err != nil {
					ch.Close()
					continue
				}
				go func() {
					_ = srv.Serve() // io.EOF＝通道關閉
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

// netRx 模擬遞增的網路計數器，讓速率計算有非零值。
var netRx atomic.Uint64

func fakeExec(cmd string) (string, string, int) {
	switch {
	case containsAll(cmd, "os-release"):
		// 必須含與 osdetect.buildDetectCommand 相同的標記區塊，parseDetectOutput 才能解析
		return "===UNAME===\n" +
			"Linux\n" +
			"6.8.0-generic\n" +
			"===OSREL===\n" +
			"ID=\"ubuntu\"\n" +
			"NAME=\"Ubuntu\"\n" +
			"VERSION_ID=\"24.04\"\n" +
			"PRETTY_NAME=\"Ubuntu 24.04 LTS\"\n", "", 0
	case containsAll(cmd, "===CPU===", "===NET==="):
		rx := netRx.Add(3000) // 每次取樣 +3000 bytes
		return linuxMetricsSample(rx), "", 0
	default:
		return "", "unknown command: " + cmd, 127
	}
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				goto next
			}
		}
		return false
	next:
	}
	return true
}

// linuxMetricsSample 與 parsers 測試樣本同構（parseLinuxMetrics 可解析）。
func linuxMetricsSample(rx uint64) string {
	return "===CPU===\n" +
		"%Cpu(s):  1.7 us,  0.6 sy,  0.0 ni, 97.2 id,  0.3 wa,  0.0 hi,  0.1 si,  0.0 st\n" +
		"\n" +
		"===MEM===\n" +
		"              total        used        free      shared  buff/cache   available\n" +
		"Mem:       16384000     8192000     4096000      131072     4096000     7800000\n" +
		"Swap:       2097152           0     2097152\n" +
		"\n" +
		"===DISK===\n" +
		"Filesystem     1024-blocks      Used Available Capacity Mounted on\n" +
		"/dev/sda1         40960000  20480000  20480000      51% /\n" +
		"tmpfs              8192000         0   8192000       0% /dev/shm\n" +
		"\n" +
		"===LOAD===\n" +
		"0.10 0.20 0.30 1/234 5678\n" +
		"\n" +
		"===NET===\n" +
		"Inter-|   Receive                                                |  Transmit\n" +
		" face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n" +
		fmt.Sprintf("    lo: 1234567    9876    0    0    0     0          0         0  1234567    9876    0    0    0     0       0          0\n") +
		fmt.Sprintf("  eth0: %d  800000    0    0    0     0          0         0 2000000000  700000    0    0    0     0       0          0\n", rx)
}

func echoShell(ch gossh.Channel) {
	defer ch.Close()
	ch.Write([]byte("dev-ssh-server shell ready（回顯模式）\r\n"))
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

func sendExitStatus(ch gossh.Channel, code int) {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload, uint32(code))
	_, _ = ch.SendRequest("exit-status", false, payload)
}

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

func seedSftpRoot(root string) {
	write := func(rel, content string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			log.Fatalf("建立目錄 %s：%v", p, err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			log.Fatalf("寫入 %s：%v", p, err)
		}
	}
	write("hello.txt", "hello from dev-ssh-server\n")
	write("notes.md", "# E2E 測試筆記\n")
	write("subdir/nested.txt", "nested file\n")
}
