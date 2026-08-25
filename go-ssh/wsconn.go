//go:build js && wasm

package main

// WsConn：以瀏覽器 WebSocket 為傳輸層的 net.Conn 實作。
// 讓 SSH 引擎經由 Worker /proxy 位元組幫浦（WS↔TCP）抵達遠端主機。
//
// 此檔依賴 syscall/js，無法以 go test 驗證；以 GOOS=js GOARCH=wasm go build
// 確認編譯，行為由前端整合與端到端測試覆蓋（同 main.go 前例）。

import (
	"errors"
	"io"
	"net"
	"sync"
	"syscall/js"
	"time"
)

// errConnClosed：連線已關閉後的讀寫錯誤。
var errConnClosed = errors.New("連線已關閉")

// WsConn 包裝前端 ProxyTransport（建構當下已同步接管 WebSocket 事件並緩衝），
// 以其穩定回呼 API（onOpen/onData/onClosed）驅動 net.Conn 語意。
type WsConn struct {
	t         js.Value // ProxyTransport 實例
	inbox     chan []byte
	done      chan struct{}
	open      chan struct{} // onOpen 時關閉；Write 等待此通道
	closeOnce sync.Once
	mu        sync.Mutex
	readBuf   []byte
	readErr   error
	callbacks []js.Func // 保留引用避免被 GC 回收
}

// NewWsConn 將 ProxyTransport 包裝為 net.Conn。註冊回呼時若對應事件
// 已發生，shim 會立即補叫，因此任何時序下皆不遺失資料或狀態。
func NewWsConn(t js.Value) *WsConn {
	c := &WsConn{
		t:     t,
		inbox: make(chan []byte, 64),
		done:  make(chan struct{}),
		open:  make(chan struct{}),
	}

	onData := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		data := args[0]
		size := data.Get("byteLength").Int()
		buf := make([]byte, size)
		js.CopyBytesToGo(buf, data)
		select {
		case c.inbox <- buf:
		case <-c.done:
		}
		return nil
	})
	onOpen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		select {
		case <-c.open:
		default:
			close(c.open)
		}
		return nil
	})
	onClosed := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		msg := t.Call("closeError").String()
		if msg == "" {
			c.closeWithError(io.EOF)
		} else {
			c.closeWithError(errors.New(msg))
		}
		return nil
	})

	c.callbacks = []js.Func{onData, onOpen, onClosed}
	t.Call("onData", onData)
	t.Call("onOpen", onOpen)
	t.Call("onClosed", onClosed)
	return c
}

func (c *WsConn) closeWithError(err error) {
	c.closeOnce.Do(func() {
		if err == nil {
			err = io.EOF
		}
		c.mu.Lock()
		if c.readErr == nil {
			c.readErr = err
		}
		c.mu.Unlock()
		close(c.done)
	})
}

// Read 讀取遠端資料；內部緩衝未清空時優先回傳殘餘位元組。
func (c *WsConn) Read(p []byte) (int, error) {
	c.mu.Lock()
	if len(c.readBuf) > 0 {
		n := copy(p, c.readBuf)
		c.readBuf = c.readBuf[n:]
		c.mu.Unlock()
		return n, nil
	}
	err := c.readErr
	c.mu.Unlock()
	if err != nil {
		return 0, err
	}

	select {
	case buf := <-c.inbox:
		n := copy(p, buf)
		if n < len(buf) {
			c.mu.Lock()
			c.readBuf = append(c.readBuf, buf[n:]...)
			c.mu.Unlock()
		}
		return n, nil
	case <-c.done:
		c.mu.Lock()
		e := c.readErr
		c.mu.Unlock()
		if e == nil {
			e = io.EOF
		}
		return 0, e
	}
}

// Write 以二進位框架送出資料；傳輸未開啟時阻塞至開啟或關閉。
// （不檢查 readyState——狀態由 open/done 通道閘門與 shim.send 內部防護保證）
func (c *WsConn) Write(p []byte) (int, error) {
	select {
	case <-c.done:
		return 0, errConnClosed
	case <-c.open:
	}
	arr := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(arr, p)
	c.t.Call("send", arr)
	return len(p), nil
}

// Close 關閉 WebSocket 與讀取迴圈。
func (c *WsConn) Close() error {
	c.closeWithError(nil)
	// WebSocket 的 close 事件會延遲派發；先解除 JS 端引用，才可安全
	// Release Go callbacks，避免 wasm_exec 呼叫已釋放的 js.Func。
	c.t.Call("disposeCallbacks")
	c.t.Call("close")
	for _, cb := range c.callbacks {
		cb.Release()
	}
	c.callbacks = nil
	return nil
}

// LocalAddr／RemoteAddr：瀏覽器環境無真實位址語意，回傳佔位值。
func (c *WsConn) LocalAddr() net.Addr                { return wsAddr{} }
func (c *WsConn) RemoteAddr() net.Addr               { return wsAddr{} }
func (c *WsConn) SetDeadline(t time.Time) error      { return nil } //nolint:revive // 佔位實作
func (c *WsConn) SetReadDeadline(t time.Time) error  { return nil } //nolint:revive // 佔位實作
func (c *WsConn) SetWriteDeadline(t time.Time) error { return nil } //nolint:revive // 佔位實作

// wsAddr：佔位位址。
type wsAddr struct{}

func (wsAddr) Network() string { return "ws" }
func (wsAddr) String() string  { return "ws-proxy" }
