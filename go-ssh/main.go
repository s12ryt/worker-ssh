//go:build js && wasm

package main

// syscall/js 橋接層：把 Go SSH 引擎暴露為瀏覽器端全域物件 `sshEngine`。
//
// 此層依賴瀏覽器環境（syscall/js），無法以 go test 驗證；
// 以 GOOS=js GOARCH=wasm go build 確認編譯，行為由前端整合與端到端測試覆蓋。
//
// JS API（皆回 Promise，除 shellWrite/shellResize/shellClose/disconnect）：
//
//	sshEngine.connect(cfg)                    → connId:number
//	  cfg = {host, port, username, authType, password?, privateKey?, passphrase?, verifyHostKey}
//	sshEngine.disconnect(connId)              → void
//	sshEngine.exec(connId, cmd)               → {stdout, stderr, exitCode}
//	sshEngine.openShell(connId, cols, rows, onData)
//	                                          → handleId:number（onData(Uint8Array)）
//	sshEngine.shellWrite(handleId, text)      → void
//	sshEngine.shellResize(handleId, cols, rows) → void
//	sshEngine.shellClose(handleId)            → void
//	sshEngine.sftpList(connId, path)          → [{name,size,isDir,modTime}]
//	sshEngine.sftpStat(connId, path)          → {name,size,isDir,modTime}|null
//	sshEngine.sftpReadFile(connId, path)      → Uint8Array
//	sshEngine.sftpWriteFile(connId, path, data:Uint8Array|string) → void
//	sshEngine.sftpOpenRead(connId, path)      → {handleId,size}
//	sshEngine.sftpReadChunk(handleId, maxBytes) → {data:Uint8Array,eof}
//	sshEngine.sftpCloseRead(handleId)         → void
//	sshEngine.sftpOpenWrite(connId, path)     → handleId:number
//	sshEngine.sftpWriteChunk(handleId, data)  → void
//	sshEngine.sftpCloseWrite(handleId)        → void
//	sshEngine.sftpMkdir(connId, path)         → void
//	sshEngine.sftpRemove(connId, path)        → void
//	sshEngine.sftpRename(connId, oldPath, newPath) → void

import (
	"fmt"
	"net"
	"sort"
	"sync"
	"syscall/js"

	gossh "golang.org/x/crypto/ssh"
)

type engineState struct {
	mu              sync.Mutex
	nextID          int
	conns           map[int]*gossh.Client
	keepaliveStops  map[int]func()
	shells          map[int]*ShellHandle
	readers         map[int]trackedReadHandle
	writers         map[int]trackedWriteHandle
}

type trackedReadHandle struct {
	connID int
	handle *SftpReadHandle
}

type trackedWriteHandle struct {
	connID int
	handle *SftpWriteHandle
}

type jsReadChunkResult struct {
	data []byte
	eof  bool
}

var state = &engineState{
	nextID:         1,
	conns:          make(map[int]*gossh.Client),
	keepaliveStops: make(map[int]func()),
	shells:         make(map[int]*ShellHandle),
	readers:        make(map[int]trackedReadHandle),
	writers:        make(map[int]trackedWriteHandle),
}

func allocID() int {
	state.mu.Lock()
	defer state.mu.Unlock()
	id := state.nextID
	state.nextID++
	return id
}

func getConn(id int) (*gossh.Client, error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	c, ok := state.conns[id]
	if !ok {
		return nil, fmt.Errorf("連線不存在或已關閉：%d", id)
	}
	return c, nil
}

func getShell(id int) (*ShellHandle, error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	h, ok := state.shells[id]
	if !ok {
		return nil, fmt.Errorf("shell 不存在或已關閉：%d", id)
	}
	return h, nil
}

// jsPromise 把同步工作函式包裝成 JS Promise。
// handler 於工作完成（resolve/reject 已呼叫）後釋放，避免長時間輪詢下無上限成長。
func jsPromise(work func() (interface{}, error)) js.Value {
	var handler js.Func
	handler = js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		resolve := args[0]
		reject := args[1]
		go func() {
			defer handler.Release()
			v, err := work()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}
			if v == nil {
				resolve.Invoke(js.Undefined())
				return
			}
			if b, ok := v.([]byte); ok {
				// 二進位結果以 Uint8Array 傳遞
				arr := js.Global().Get("Uint8Array").New(len(b))
				js.CopyBytesToJS(arr, b)
				resolve.Invoke(arr)
				return
			}
			if chunk, ok := v.(jsReadChunkResult); ok {
				arr := js.Global().Get("Uint8Array").New(len(chunk.data))
				js.CopyBytesToJS(arr, chunk.data)
				obj := js.Global().Get("Object").New()
				obj.Set("data", arr)
				obj.Set("eof", chunk.eof)
				resolve.Invoke(obj)
				return
			}
			resolve.Invoke(js.ValueOf(v))
		}()
		return nil
	})
	promise := js.Global().Get("Promise").New(handler)
	return promise
}

func jsErrorValue(err error) js.Value {
	return js.Global().Get("Error").New(err.Error())
}

type hostKeyVerificationResult struct {
	trusted bool
	err     error
}

func jsRejectionMessage(value js.Value) string {
	if value.Type() == js.TypeObject {
		message := value.Get("message")
		if message.Type() == js.TypeString && message.String() != "" {
			return message.String()
		}
	}
	if value.Type() == js.TypeString {
		return value.String()
	}
	return "host key verifier Promise 被拒絕"
}

// awaitJSHostKeyVerifier 將前端同步或 Promise verifier 轉成 Go 的同步驗證結果。
func awaitJSHostKeyVerifier(
	verifier js.Value,
	hostname string,
	keyType string,
	fingerprint string,
) (err error) {
	if verifier.Type() != js.TypeFunction {
		return fmt.Errorf("SSH host key verifier 未設定")
	}

	resultCh := make(chan hostKeyVerificationResult, 1)
	var fulfilled js.Func
	var rejected js.Func
	fulfilled = js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		trusted := len(args) > 0 && args[0].Truthy()
		resultCh <- hostKeyVerificationResult{trusted: trusted}
		return nil
	})
	rejected = js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		message := "host key verifier Promise 被拒絕"
		if len(args) > 0 {
			message = jsRejectionMessage(args[0])
		}
		resultCh <- hostKeyVerificationResult{err: fmt.Errorf("%s", message)}
		return nil
	})
	defer fulfilled.Release()
	defer rejected.Release()

	var invokeErr error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				invokeErr = fmt.Errorf("呼叫 host key verifier 失敗：%v", recovered)
			}
		}()
		value := verifier.Invoke(map[string]interface{}{
			"hostname":    hostname,
			"keyType":     keyType,
			"fingerprint": fingerprint,
		})
		promise := js.Global().Get("Promise").Call("resolve", value)
		promise.Call("then", fulfilled, rejected)
	}()
	if invokeErr != nil {
		return invokeErr
	}

	result := <-resultCh
	if result.err != nil {
		return result.err
	}
	if !result.trusted {
		return fmt.Errorf("SSH host key 已被使用者拒絕")
	}
	return nil
}

// entryToJS 把 Entry 轉為 JS 物件。
func entryToJS(e Entry) map[string]interface{} {
	return map[string]interface{}{
		"name":    e.Name,
		"size":    e.Size,
		"isDir":   e.IsDir,
		"mode":    int(e.Mode),
		"modTime": e.ModTime,
	}
}

func entriesToJS(entries []Entry) []interface{} {
	out := make([]interface{}, 0, len(entries))
	for _, e := range entries {
		out = append(out, entryToJS(e))
	}
	return out
}

func main() {
	engine := map[string]interface{}{
		"connect":        js.FuncOf(jsConnect),
		"disconnect":     js.FuncOf(jsDisconnect),
		"exec":           js.FuncOf(jsExec),
		"openShell":      js.FuncOf(jsOpenShell),
		"shellWrite":     js.FuncOf(jsShellWrite),
		"shellResize":    js.FuncOf(jsShellResize),
		"shellClose":     js.FuncOf(jsShellClose),
		"sftpList":       js.FuncOf(jsSftpList),
		"sftpStat":       js.FuncOf(jsSftpStat),
		"sftpReadFile":   js.FuncOf(jsSftpReadFile),
		"sftpWriteFile":  js.FuncOf(jsSftpWriteFile),
		"sftpOpenRead":   js.FuncOf(jsSftpOpenRead),
		"sftpReadChunk":  js.FuncOf(jsSftpReadChunk),
		"sftpCloseRead":  js.FuncOf(jsSftpCloseRead),
		"sftpOpenWrite":  js.FuncOf(jsSftpOpenWrite),
		"sftpWriteChunk": js.FuncOf(jsSftpWriteChunk),
		"sftpCloseWrite": js.FuncOf(jsSftpCloseWrite),
		"sftpMkdir":      js.FuncOf(jsSftpMkdir),
		"sftpRemove":     js.FuncOf(jsSftpRemove),
		"sftpRename":     js.FuncOf(jsSftpRename),
	}
	js.Global().Set("sshEngine", engine)

	// 保持 wasm 活著（事件迴圈由 wasm_exec.js 驅動）
	select {}
}

// ---- 連線 ----

func jsConnect(this js.Value, args []js.Value) interface{} {
	cfgJS := args[0]
	getStr := func(key string) string {
		v := cfgJS.Get(key)
		if v.Type() == js.TypeString {
			return v.String()
		}
		return ""
	}
	getInt := func(key string) int {
		v := cfgJS.Get(key)
		if v.Type() == js.TypeNumber {
			return int(v.Float())
		}
		return 0
	}
	cfg := ConnConfig{
		Host:       getStr("host"),
		Port:       getInt("port"),
		Username:   getStr("username"),
		AuthType:   getStr("authType"),
		Password:   getStr("password"),
		PrivateKey: getStr("privateKey"),
		Passphrase: getStr("passphrase"),
	}
	// sshOptions：[{key, value}]（Worker 端已以白名單驗證）
	if opts := cfgJS.Get("sshOptions"); opts.Type() == js.TypeObject && opts.Length() > 0 {
		list := make([]SshOption, 0, opts.Length())
		for i := 0; i < opts.Length(); i++ {
			item := opts.Index(i)
			key := item.Get("key")
			value := item.Get("value")
			if key.Type() == js.TypeString && value.Type() == js.TypeString {
				list = append(list, SshOption{Key: key.String(), Value: value.String()})
			}
		}
		if len(list) > 0 {
			cfg.SshOptions = list
		}
	}
	verifier := cfgJS.Get("verifyHostKey")
	if verifier.Type() == js.TypeFunction {
		cfg.HostKeyVerifier = func(hostname, keyType, fingerprint string) error {
			return awaitJSHostKeyVerifier(
				verifier,
				hostname,
				keyType,
				fingerprint,
			)
		}
	}
	// transport：前端 ProxyTransport（建構當下已接管 /proxy WebSocket 事件）。
	// 提供時 SSH 協議經此通道傳輸；未提供時退回原生 TCP（僅非瀏覽器環境）。
	transport := cfgJS.Get("transport")
	return jsPromise(func() (interface{}, error) {
		var client *gossh.Client
		var stopKeepalive func()
		var err error
		if transport.Type() == js.TypeObject && !transport.Get("onData").IsUndefined() {
			client, stopKeepalive, err = DialClientWithDialer(cfg, func(network, addr string) (net.Conn, error) {
				return NewWsConn(transport), nil
			})
		} else {
			client, stopKeepalive, err = DialClient(cfg)
		}
		if err != nil {
			return nil, err
		}
		id := allocID()
		state.mu.Lock()
		state.conns[id] = client
		state.keepaliveStops[id] = stopKeepalive
		state.mu.Unlock()
		return id, nil
	})
}

func jsDisconnect(this js.Value, args []js.Value) interface{} {
	id := args[0].Int()
	state.mu.Lock()
	client, ok := state.conns[id]
	if ok {
		delete(state.conns, id)
	}
	stop, hasStop := state.keepaliveStops[id]
	if hasStop {
		delete(state.keepaliveStops, id)
	}
	readers := make([]*SftpReadHandle, 0)
	for handleID, tracked := range state.readers {
		if tracked.connID == id {
			readers = append(readers, tracked.handle)
			delete(state.readers, handleID)
		}
	}
	writers := make([]*SftpWriteHandle, 0)
	for handleID, tracked := range state.writers {
		if tracked.connID == id {
			writers = append(writers, tracked.handle)
			delete(state.writers, handleID)
		}
	}
	state.mu.Unlock()
	for _, reader := range readers {
		reader.Close()
	}
	for _, writer := range writers {
		writer.Close()
	}
	if hasStop {
		stop()
	}
	if ok {
		client.Close()
	}
	return js.Undefined()
}

// ---- exec / shell ----

func jsExec(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	cmd := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		stdout, stderr, code, err := RunCommand(c, cmd)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"stdout":   stdout,
			"stderr":   stderr,
			"exitCode": code,
		}, nil
	})
}

func jsOpenShell(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	cols := uint32(args[1].Float())
	rows := uint32(args[2].Float())
	onData := args[3] // JS callback function

	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		// 直接把輸出轉成 Uint8Array 交給 JS 回呼，避免多餘的 Go↔JS 往返拷貝
		h, err := OpenShell(c, cols, rows, func(data []byte) {
			arr := js.Global().Get("Uint8Array").New(len(data))
			js.CopyBytesToJS(arr, data)
			go onData.Invoke(arr)
		})
		if err != nil {
			return nil, err
		}
		id := allocID()
		state.mu.Lock()
		state.shells[id] = h
		state.mu.Unlock()
		return id, nil
	})
}

func jsShellWrite(this js.Value, args []js.Value) interface{} {
	id := args[0].Int()
	text := args[1].String()
	h, err := getShell(id)
	if err != nil {
		return jsErrorValue(err)
	}
	if err := h.Write([]byte(text)); err != nil {
		return jsErrorValue(err)
	}
	return js.Undefined()
}

func jsShellResize(this js.Value, args []js.Value) interface{} {
	id := args[0].Int()
	cols := uint32(args[1].Float())
	rows := uint32(args[2].Float())
	h, err := getShell(id)
	if err == nil {
		h.Resize(cols, rows)
	}
	return js.Undefined()
}

func jsShellClose(this js.Value, args []js.Value) interface{} {
	id := args[0].Int()
	state.mu.Lock()
	h, ok := state.shells[id]
	if ok {
		delete(state.shells, id)
	}
	state.mu.Unlock()
	if ok {
		h.Close()
	}
	return js.Undefined()
}

// ---- SFTP ----

func jsSftpList(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		entries, err := SftpList(c, path)
		if err != nil {
			return nil, err
		}
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].IsDir != entries[j].IsDir {
				return entries[i].IsDir // 目錄優先
			}
			return entries[i].Name < entries[j].Name
		})
		return entriesToJS(entries), nil
	})
}

func jsSftpStat(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		e, err := SftpStat(c, path)
		if err != nil {
			return nil, err
		}
		return entryToJS(*e), nil
	})
}

func jsSftpReadFile(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		return SftpReadFile(c, path)
	})
}

func jsBytesArg(v js.Value) []byte {
	if v.InstanceOf(js.Global().Get("Uint8Array")) || v.InstanceOf(js.Global().Get("ArrayBuffer")) {
		data := make([]byte, v.Length())
		js.CopyBytesToGo(data, v)
		return data
	}
	return []byte(v.String())
}

func jsSftpWriteFile(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	data := jsBytesArg(args[2])
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		return nil, SftpWriteFile(c, path, data)
	})
}

func jsSftpOpenRead(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		handle, size, err := SftpOpenRead(c, path)
		if err != nil {
			return nil, err
		}
		id := allocID()
		state.mu.Lock()
		state.readers[id] = trackedReadHandle{connID: connID, handle: handle}
		state.mu.Unlock()
		return map[string]interface{}{"handleId": id, "size": float64(size)}, nil
	})
}

func jsSftpReadChunk(this js.Value, args []js.Value) interface{} {
	handleID := args[0].Int()
	maxBytes := args[1].Int()
	return jsPromise(func() (interface{}, error) {
		state.mu.Lock()
		tracked, ok := state.readers[handleID]
		state.mu.Unlock()
		if !ok {
			return nil, fmt.Errorf("SFTP 讀取控制代碼不存在：%d", handleID)
		}
		data, eof, err := tracked.handle.ReadChunk(maxBytes)
		if err != nil {
			return nil, err
		}
		return jsReadChunkResult{data: data, eof: eof}, nil
	})
}

func jsSftpCloseRead(this js.Value, args []js.Value) interface{} {
	handleID := args[0].Int()
	return jsPromise(func() (interface{}, error) {
		state.mu.Lock()
		tracked, ok := state.readers[handleID]
		if ok {
			delete(state.readers, handleID)
		}
		state.mu.Unlock()
		if !ok {
			return nil, nil
		}
		return nil, tracked.handle.Close()
	})
}

func jsSftpOpenWrite(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		handle, err := SftpOpenWrite(c, path)
		if err != nil {
			return nil, err
		}
		id := allocID()
		state.mu.Lock()
		state.writers[id] = trackedWriteHandle{connID: connID, handle: handle}
		state.mu.Unlock()
		return id, nil
	})
}

func jsSftpWriteChunk(this js.Value, args []js.Value) interface{} {
	handleID := args[0].Int()
	data := jsBytesArg(args[1])
	return jsPromise(func() (interface{}, error) {
		state.mu.Lock()
		tracked, ok := state.writers[handleID]
		state.mu.Unlock()
		if !ok {
			return nil, fmt.Errorf("SFTP 寫入控制代碼不存在：%d", handleID)
		}
		return nil, tracked.handle.WriteChunk(data)
	})
}

func jsSftpCloseWrite(this js.Value, args []js.Value) interface{} {
	handleID := args[0].Int()
	return jsPromise(func() (interface{}, error) {
		state.mu.Lock()
		tracked, ok := state.writers[handleID]
		if ok {
			delete(state.writers, handleID)
		}
		state.mu.Unlock()
		if !ok {
			return nil, nil
		}
		return nil, tracked.handle.Close()
	})
}

func jsSftpMkdir(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		return nil, SftpMkdir(c, path)
	})
}

func jsSftpRemove(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	path := args[1].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		return nil, SftpRemove(c, path)
	})
}

func jsSftpRename(this js.Value, args []js.Value) interface{} {
	connID := args[0].Int()
	oldPath := args[1].String()
	newPath := args[2].String()
	return jsPromise(func() (interface{}, error) {
		c, err := getConn(connID)
		if err != nil {
			return nil, err
		}
		return nil, SftpRename(c, oldPath, newPath)
	})
}
