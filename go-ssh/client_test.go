package main

import (
	"fmt"
	"strings"
	"testing"
)

// 契約：DialClient 以密碼認證成功建立 SSH 連線。
func TestDialClientPassword(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "password",
		Password:        testPassword,
		HostKeyVerifier: trustTestServer(ts),
	})
	if err != nil {
		t.Fatalf("密碼認證應成功，得到錯誤：%v", err)
	}
	defer client.Close()
}

// 契約：錯誤密碼必須回傳錯誤。
func TestDialClientWrongPassword(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "password",
		Password:        "wrong-pass",
		HostKeyVerifier: trustTestServer(ts),
	})
	if err == nil {
		client.Close()
		t.Fatal("錯誤密碼應回傳錯誤")
	}
}

// 契約：私鑰（PKCS8 ed25519）公鑰認證成功。
func TestDialClientPrivateKey(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "privateKey",
		PrivateKey:      string(ts.privatePEM),
		HostKeyVerifier: trustTestServer(ts),
	})
	if err != nil {
		t.Fatalf("私鑰認證應成功，得到錯誤：%v", err)
	}
	defer client.Close()
}

// 契約：加密私鑰＋正確 passphrase 認證成功。
func TestDialClientEncryptedKeyWithPassphrase(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "privateKey",
		PrivateKey:      string(ts.encPEM),
		Passphrase:      ts.passphrase,
		HostKeyVerifier: trustTestServer(ts),
	})
	if err != nil {
		t.Fatalf("加密私鑰＋正確 passphrase 應成功：%v", err)
	}
	defer client.Close()
}

// 契約：加密私鑰＋錯誤 passphrase 必須回傳錯誤。
func TestDialClientEncryptedKeyWrongPassphrase(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "privateKey",
		PrivateKey:      string(ts.encPEM),
		Passphrase:      "not-the-pass",
		HostKeyVerifier: trustTestServer(ts),
	})
	if err == nil {
		client.Close()
		t.Fatal("錯誤 passphrase 應回傳錯誤")
	}
}

// 契約：privateKey 認證但未提供私鑰 → 明確錯誤（非 panic）。
func TestDialClientPrivateKeyMissing(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:            hostOf(ts.addr),
		Port:            portOf(ts.addr),
		Username:        testUser,
		AuthType:        "privateKey",
		HostKeyVerifier: trustTestServer(ts),
	})
	if err == nil {
		client.Close()
		t.Fatal("缺少私鑰應回傳錯誤")
	}
}

func TestDialClientHostKeyVerifierReceivesSHA256Fingerprint(t *testing.T) {
	ts := startTestServer(t)
	var gotHost, gotType, gotFingerprint string
	client, err := DialClient(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: func(hostname, keyType, fingerprint string) error {
			gotHost = hostname
			gotType = keyType
			gotFingerprint = fingerprint
			return nil
		},
	})
	if err != nil {
		t.Fatalf("接受 host key 後應連線成功：%v", err)
	}
	defer client.Close()
	if gotHost != ts.addr {
		t.Errorf("hostname = %q，想要 %q", gotHost, ts.addr)
	}
	if gotType != ts.hostKeyType {
		t.Errorf("key type = %q，想要 %q", gotType, ts.hostKeyType)
	}
	if gotFingerprint != ts.hostKeyFingerprint {
		t.Errorf("fingerprint = %q，想要 %q", gotFingerprint, ts.hostKeyFingerprint)
	}
}

func TestDialClientRejectsUntrustedHostKey(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
		HostKeyVerifier: func(_, _, _ string) error {
			return fmt.Errorf("host key 已被使用者拒絕")
		},
	})
	if err == nil {
		client.Close()
		t.Fatal("被拒絕的 host key 不得建立連線")
	}
	if !strings.Contains(err.Error(), "已被使用者拒絕") {
		t.Fatalf("錯誤應保留 verifier 原因，得到：%v", err)
	}
}

func TestDialClientFailsClosedWithoutHostKeyVerifier(t *testing.T) {
	ts := startTestServer(t)
	client, err := DialClient(ConnConfig{
		Host:     hostOf(ts.addr),
		Port:     portOf(ts.addr),
		Username: testUser,
		AuthType: "password",
		Password: testPassword,
	})
	if err == nil {
		client.Close()
		t.Fatal("缺少 host key verifier 時必須拒絕連線")
	}
	if !strings.Contains(err.Error(), "host key") {
		t.Fatalf("錯誤應說明 host key verifier 缺失，得到：%v", err)
	}
}
