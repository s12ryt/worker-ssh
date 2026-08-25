package main

import (
	"strings"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// ---- applySshOptions：純映射 ----

// 契約：清單選項映射到 ssh.Config 對應欄位、ConnectTimeout 覆蓋逾時。
func TestApplySshOptionsMapsProtocolLists(t *testing.T) {
	cc := &gossh.ClientConfig{Timeout: connectTimeout}
	applySshOptions([]SshOption{
		{Key: "Ciphers", Value: "aes128-ctr,aes256-ctr"},
		{Key: "MACs", Value: "hmac-sha2-256"},
		{Key: "KexAlgorithms", Value: "curve25519-sha256,ecdh-sha2-nistp256"},
		{Key: "HostKeyAlgorithms", Value: "ssh-ed25519"},
		{Key: "ConnectTimeout", Value: "5"},
	}, cc, connectTimeout)
	if want := ([]string{"aes128-ctr", "aes256-ctr"}); !equalStrings(cc.Config.Ciphers, want) {
		t.Errorf("CipherSuites = %v，想要 %v", cc.Config.Ciphers, want)
	}
	if want := ([]string{"hmac-sha2-256"}); !equalStrings(cc.Config.MACs, want) {
		t.Errorf("MACs = %v，想要 %v", cc.Config.MACs, want)
	}
	if want := ([]string{"curve25519-sha256", "ecdh-sha2-nistp256"}); !equalStrings(cc.Config.KeyExchanges, want) {
		t.Errorf("KeyExchanges = %v，想要 %v", cc.Config.KeyExchanges, want)
	}
	if want := ([]string{"ssh-ed25519"}); !equalStrings(cc.HostKeyAlgorithms, want) {
		t.Errorf("HostKeyAlgorithms = %v，想要 %v", cc.HostKeyAlgorithms, want)
	}
	if cc.Timeout != 5*time.Second {
		t.Errorf("Timeout = %v，想要 5s", cc.Timeout)
	}
}

// 契約：選項鍵大小寫不敏感；未知鍵（如 ProxyCommand）安靜忽略。
func TestApplySshOptionsKeyCaseInsensitiveAndIgnoresUnknown(t *testing.T) {
	cc := &gossh.ClientConfig{Timeout: connectTimeout}
	applySshOptions([]SshOption{
		{Key: "ciphers", Value: "aes128-ctr"},
		{Key: "ProxyCommand", Value: "cloudflared access ssh --hostname x"},
	}, cc, connectTimeout)

	if want := ([]string{"aes128-ctr"}); !equalStrings(cc.Config.Ciphers, want) {
		t.Errorf("CipherSuites = %v，想要 %v", cc.Config.Ciphers, want)
	}
}

// 契約：無選項時不更動 ClientConfig。
func TestApplySshOptionsNoOptionsKeepsDefaults(t *testing.T) {
	cc := &gossh.ClientConfig{Timeout: connectTimeout}
	applySshOptions(nil, cc, connectTimeout)
	if cc.Timeout != connectTimeout {
		t.Errorf("Timeout = %v，想要預設 %v", cc.Timeout, connectTimeout)
	}
	if len(cc.Config.Ciphers) != 0 {
		t.Errorf("CipherSuites 應保持空，得到 %v", cc.Config.Ciphers)
	}
}

// 契約：ServerAliveInterval 啟用 keepalive；僅 CountMax 而無 Interval 不啟用；
// Interval 有而 CountMax 缺 → OpenSSH 預設 3。
func TestKeepaliveFromOptions(t *testing.T) {
	ka, ok := keepaliveFromOptions([]SshOption{
		{Key: "ServerAliveInterval", Value: "30"},
		{Key: "ServerAliveCountMax", Value: "5"},
	})
	if !ok || ka.interval != 30*time.Second || ka.maxFailures != 5 {
		t.Fatalf("keepalive = %+v ok=%v，想要 30s/5", ka, ok)
	}

	kaDefault, ok := keepaliveFromOptions([]SshOption{
		{Key: "ServerAliveInterval", Value: "10"},
	})
	if !ok || kaDefault.maxFailures != 3 {
		t.Fatalf("缺 CountMax 應預設 3，得到 %+v ok=%v", kaDefault, ok)
	}

	_, ok = keepaliveFromOptions([]SshOption{
		{Key: "ServerAliveCountMax", Value: "3"},
	})
	if ok {
		t.Fatal("無 Interval 不應啟用 keepalive")
	}

	_, ok = keepaliveFromOptions([]SshOption{
		{Key: "ServerAliveInterval", Value: "0"},
	})
	if ok {
		t.Fatal("Interval=0（停用語意）不應啟用 keepalive")
	}
}

// ---- E2E：協議選項真的流進 handshake ----

// 契約：Ciphers=aes128-ctr 限制可完成交握並執行指令。
func TestDialClientRestrictedCipherSucceeds(t *testing.T) {
	ts := startTestServer(t)
	client, _, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
		SshOptions: []SshOption{
			{Key: "Ciphers", Value: "aes128-ctr"},
			{Key: "HostKeyAlgorithms", Value: "ssh-ed25519"},
		},
	}, nil)
	if err != nil {
		t.Fatalf("限制 cipher 應交握成功：%v", err)
	}
	defer client.Close()

	stdout, _, _, err := RunCommand(client, "out:hello")
	if err != nil || stdout != "hello" {
		t.Fatalf("exec 應正常運作：stdout=%q err=%v", stdout, err)
	}
}

// 契約：無效 cipher 名流入 handshake → 交握失敗（選項確實生效）。
func TestDialClientBogusCipherFailsHandshake(t *testing.T) {
	ts := startTestServer(t)
	client, _, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
		SshOptions: []SshOption{
			{Key: "Ciphers", Value: "bogus-cipher"},
		},
	}, nil)
	if err == nil {
		client.Close()
		t.Fatal("無效 cipher 應導致交握失敗")
	}
	if !strings.Contains(err.Error(), "cipher") {
		t.Fatalf("錯誤應提及 cipher 協商，得到：%v", err)
	}
}

// ---- keepalive 行為 ----

// 契約：ServerAliveInterval=40ms → 500ms 觀察窗內 server 收到 >=3 次
// keepalive@openssh.com，且期間連線仍可運作。
func TestKeepaliveSendsPeriodicRequests(t *testing.T) {
	ts := startTestServer(t)
	client, _, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
	}, nil)
	if err != nil {
		t.Fatalf("連線應成功：%v", err)
	}
	defer client.Close()

	stop := goKeepalive(client, keepaliveSettings{interval: 40 * time.Millisecond, maxFailures: 3})
	defer stop()

	before := ts.KeepaliveCount()
	time.Sleep(500 * time.Millisecond)
	after := ts.KeepaliveCount()
	if after-before < 3 {
		t.Fatalf("500ms 內 keepalive 請求 %d 次，想要 >=3", after-before)
	}

	// keepalive 不應干擾正常通道
	stdout, _, _, err := RunCommand(client, "out:still-alive")
	if err != nil || stdout != "still-alive" {
		t.Fatalf("keepalive 期間 exec 應正常：stdout=%q err=%v", stdout, err)
	}
}

// 契約：未設定 ServerAliveInterval → 不發任何 keepalive。
func TestKeepaliveNotConfiguredSendsNothing(t *testing.T) {
	ts := startTestServer(t)
	client, stop, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
	}, nil)
	if err != nil {
		t.Fatalf("連線應成功：%v", err)
	}
	defer stop()
	defer client.Close()

	time.Sleep(250 * time.Millisecond)
	if n := ts.KeepaliveCount(); n != 0 {
		t.Fatalf("未設定 keepalive 卻收到 %d 次請求", n)
	}
}

// 契約：stop() 後不再發 keepalive（goroutine 收尾，無洩漏）。
func TestKeepaliveStopHaltsRequests(t *testing.T) {
	ts := startTestServer(t)
	client, stop, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
	}, nil)
	if err != nil {
		t.Fatalf("連線應成功：%v", err)
	}
	defer client.Close()

	stop2 := goKeepalive(client, keepaliveSettings{interval: 40 * time.Millisecond, maxFailures: 3})
	time.Sleep(150 * time.Millisecond) // 累積幾次
	stop2()
	atStop := ts.KeepaliveCount()
	time.Sleep(250 * time.Millisecond)
	if n := ts.KeepaliveCount(); n != atStop {
		t.Fatalf("stop 後請求仍增加：%d → %d", atStop, n)
	}
	_ = stop
}

// 契約：SshOptions 設定 ServerAliveInterval=1 → 連線後自動發 keepalive。
func TestKeepaliveEnabledViaSshOptions(t *testing.T) {
	ts := startTestServer(t)
	client, _, err := DialClientWithDialer(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: trustTestServer(ts),
		SshOptions: []SshOption{
			{Key: "ServerAliveInterval", Value: "1"},
		},
	}, nil)
	if err != nil {
		t.Fatalf("連線應成功：%v", err)
	}
	defer client.Close()

	time.Sleep(2300 * time.Millisecond)
	if n := ts.KeepaliveCount(); n < 2 {
		t.Fatalf("Interval=1s 觀察 2.3s 應收到 >=2 次 keepalive，得到 %d", n)
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
