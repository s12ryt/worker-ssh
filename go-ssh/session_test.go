package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

func dialTestClient(t *testing.T, ts *testServer) *gossh.Client {
	t.Helper()
	c, _, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "password",
		Password:        testPassword,
		HostKeyVerifier: trustTestServer(ts),
	})
	if err != nil {
		t.Fatalf("建立測試連線失敗：%v", err)
	}
	return c
}

// 契約：RunCommand 回傳 stdout。
func TestRunCommandStdout(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	stdout, stderr, code, err := RunCommand(c, "out:hello world")
	if err != nil {
		t.Fatalf("RunCommand 錯誤：%v", err)
	}
	if stdout != "hello world" {
		t.Errorf("stdout = %q，想要 %q", stdout, "hello world")
	}
	if stderr != "" {
		t.Errorf("stderr 應為空，得到 %q", stderr)
	}
	if code != 0 {
		t.Errorf("exit code = %d，想要 0", code)
	}
}

// 契約：RunCommand 回傳 stderr 與非零 exit code。
func TestRunCommandFail(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	stdout, stderr, code, err := RunCommand(c, "fail:2:boom")
	if err != nil {
		t.Fatalf("RunCommand 不應回傳傳輸錯誤：%v", err)
	}
	if stdout != "" {
		t.Errorf("stdout 應為空，得到 %q", stdout)
	}
	if stderr != "boom" {
		t.Errorf("stderr = %q，想要 %q", stderr, "boom")
	}
	if code != 2 {
		t.Errorf("exit code = %d，想要 2", code)
	}
}

// 契約：stdout 與 stderr 同時存在時各自正確。
func TestRunCommandBothStreams(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	stdout, stderr, code, err := RunCommand(c, "both:aaa|bbb")
	if err != nil {
		t.Fatalf("RunCommand 錯誤：%v", err)
	}
	if stdout != "aaa" || stderr != "bbb" || code != 0 {
		t.Errorf("stdout=%q stderr=%q code=%d，想要 aaa/bbb/0", stdout, stderr, code)
	}
}

// 契約：OpenShell 後寫入的資料會透過 onData 回呼送達（回顯伺服器）。
func TestOpenShellEcho(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	var mu bytes.Buffer
	got := make(chan struct{}, 16)
	h, err := OpenShell(c, 80, 24, func(data []byte) {
		mu.Write(data)
		select {
		case got <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("OpenShell 失敗：%v", err)
	}
	defer h.Close()

	if err := h.Write([]byte("ping")); err != nil {
		t.Fatalf("shell Write 失敗：%v", err)
	}

	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-got:
			if strings.Contains(mu.String(), "ping") {
				return // 通過
			}
		case <-deadline:
			t.Fatalf("5 秒內未收到回顯資料，累計收到：%q", mu.String())
		}
	}
}

// 契約：Resize 不應造成錯誤或 panic（best-effort）。
func TestShellResize(t *testing.T) {
	ts := startTestServer(t)
	c := dialTestClient(t, ts)
	defer c.Close()

	h, err := OpenShell(c, 80, 24, func([]byte) {})
	if err != nil {
		t.Fatalf("OpenShell 失敗：%v", err)
	}
	defer h.Close()
	h.Resize(120, 40) // 不回傳錯誤；僅要求不 panic
}
