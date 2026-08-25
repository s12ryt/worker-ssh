package main

import (
	"bytes"
	"fmt"
	"io"
	"sync"

	gossh "golang.org/x/crypto/ssh"
)

// RunCommand 在遠端執行單次指令，回傳 stdout、stderr 與 exit code。
// 傳輸層錯誤（非指令本身的非零結束）以 err 回傳且 exitCode = -1。
func RunCommand(c *gossh.Client, cmd string) (stdout, stderr string, exitCode int, err error) {
	sess, err := c.NewSession()
	if err != nil {
		return "", "", -1, fmt.Errorf("建立 session 失敗：%w", err)
	}
	defer sess.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	sess.Stdout = &stdoutBuf
	sess.Stderr = &stderrBuf

	runErr := sess.Run(cmd)
	if runErr == nil {
		return stdoutBuf.String(), stderrBuf.String(), 0, nil
	}
	var exitErr *gossh.ExitError
	if ok := asExitError(runErr, &exitErr); ok {
		return stdoutBuf.String(), stderrBuf.String(), exitErr.ExitStatus(), nil
	}
	// 非預期錯誤（網路斷線等）
	return stdoutBuf.String(), stderrBuf.String(), -1, runErr
}

func asExitError(err error, target **gossh.ExitError) bool {
	if e, ok := err.(*gossh.ExitError); ok {
		*target = e
		return true
	}
	return false
}

// ShellHandle 代表一個互動式 shell 通道。
type ShellHandle struct {
	mu     sync.Mutex
	sess   *gossh.Session
	stdin  io.WriteCloser
	onData func([]byte)
	closed bool
}

// writerFunc 把回呼函式包裝成 io.Writer。
type writerFunc func([]byte)

func (f writerFunc) Write(p []byte) (int, error) {
	f(p)
	return len(p), nil
}

// OpenShell 開啟互動式 shell（帶 PTY），遠端輸出經 onData 回呼送達。
func OpenShell(c *gossh.Client, cols, rows uint32, onData func([]byte)) (*ShellHandle, error) {
	if onData == nil {
		onData = func([]byte) {}
	}
	sess, err := c.NewSession()
	if err != nil {
		return nil, fmt.Errorf("建立 session 失敗：%w", err)
	}

	h := &ShellHandle{sess: sess, onData: onData}
	sess.Stdout = writerFunc(onData)
	sess.Stderr = writerFunc(onData)

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return nil, fmt.Errorf("取得 stdin 失敗：%w", err)
	}
	h.stdin = stdin

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 115200,
		gossh.TTY_OP_OSPEED: 115200,
	}
	if err := sess.RequestPty("xterm-256color", int(rows), int(cols), modes); err != nil {
		sess.Close()
		return nil, fmt.Errorf("請求 PTY 失敗：%w", err)
	}
	if err := sess.Shell(); err != nil {
		sess.Close()
		return nil, fmt.Errorf("啟動 shell 失敗：%w", err)
	}

	// 等待 session 結束（遠端登出或通道關閉），確保資源回收。
	go func() { _ = sess.Wait() }()
	return h, nil
}

// Write 送資料到遠端 shell stdin。
func (h *ShellHandle) Write(data []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.stdin == nil {
		return io.ErrClosedPipe
	}
	_, err := h.stdin.Write(data)
	return err
}

// Resize 調整 PTY 大小（best-effort，不回報錯誤）。
func (h *ShellHandle) Resize(cols, rows uint32) {
	h.mu.Lock()
	sess := h.sess
	closed := h.closed
	h.mu.Unlock()
	if sess == nil || closed {
		return
	}
	_ = sess.WindowChange(int(rows), int(cols))
}

// Close 關閉 shell 通道並釋放資源；重複呼叫安全。
func (h *ShellHandle) Close() error {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil
	}
	h.closed = true
	sess := h.sess
	stdin := h.stdin
	h.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if sess != nil {
		return sess.Close()
	}
	return nil
}
