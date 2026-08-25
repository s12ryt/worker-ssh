import { describe, expect, it, vi } from "vitest";
import {
  BackendHostKeyMismatchError,
  BackendSshClient,
} from "../../../src/frontend/backend-ssh-client";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.onclose?.({ code });
  }

  open(): void {
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const CONNECTION = {
  id: "conn/1",
  folderId: null,
  name: "Fixture",
  host: "127.0.0.1",
  port: 2222,
  username: "tester",
  authType: "password" as const,
  credentialState: "ready" as const,
  createdAt: 1,
  updatedAt: 1,
};

describe("BackendSshClient", () => {
  it("瀏覽器只用 connection id 建立 WS，host-key challenge 經 verifier 回覆", async () => {
    const socket = new FakeWebSocket();
    const verifier = vi.fn(async () => true);
    const client = new BackendSshClient({
      webSocketFactory: (url) => {
        expect(url).toContain("/api/ssh?connectionId=conn%2F1");
        expect(url).not.toContain("secret");
        return socket as unknown as WebSocket;
      },
    });

    const connected = client.connect(CONNECTION, undefined, verifier);
    socket.open();
    socket.receive({
      type: "host-key",
      challengeId: "h1",
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:actual",
    });
    await Promise.resolve();
    expect(verifier).toHaveBeenCalledWith({
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:actual",
    });
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "host-key-response",
      challengeId: "h1",
      accepted: true,
    });
    socket.receive({ type: "state", state: "ready" });
    await expect(connected).resolves.toBe(1);
  });

  it("request id 對應 exec 回應，shell data 轉為 Uint8Array", async () => {
    const socket = new FakeWebSocket();
    const client = new BackendSshClient({
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connected = client.connect(CONNECTION);
    socket.open();
    socket.receive({ type: "state", state: "ready" });
    await connected;

    const exec = client.exec(1, "whoami");
    const request = JSON.parse(socket.sent.at(-1)!) as { id: string };
    socket.receive({
      type: "response",
      id: request.id,
      ok: true,
      result: { stdout: "tester", stderr: "", exitCode: 0 },
    });
    await expect(exec).resolves.toMatchObject({ stdout: "tester", exitCode: 0 });

    const onData = vi.fn();
    const shell = client.openShell(1, 80, 24, onData);
    const shellRequest = JSON.parse(socket.sent.at(-1)!) as { id: string };
    socket.receive({ type: "response", id: shellRequest.id, ok: true, result: { shellId: 8 } });
    await shell;
    socket.receive({ type: "shell-data", base64: "b2s=" });
    expect(new TextDecoder().decode(onData.mock.calls[0]![0])).toBe("ok");
  });

  it("提供舊面板所需的 shell、SFTP 與斷線介面", async () => {
    const socket = new FakeWebSocket();
    const client = new BackendSshClient({
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connected = client.connect(CONNECTION);
    socket.open();
    socket.receive({ type: "state", state: "ready" });
    const connId = await connected;

    const respond = (result: unknown) => {
      const request = JSON.parse(socket.sent.at(-1)!) as { id: string };
      socket.receive({ type: "response", id: request.id, ok: true, result });
    };

    const list = client.list(connId, "/tmp");
    respond([{ name: "a", size: 2, isDir: false, mode: 420, modTime: "now" }]);
    await expect(list).resolves.toHaveLength(1);

    const stat = client.stat(connId, "/tmp/a");
    respond({ name: "a", size: 2, isDir: false, mode: 420, modTime: "now" });
    await expect(stat).resolves.toMatchObject({ name: "a" });

    for (const start of [
      () => client.mkdir(connId, "/tmp/d"),
      () => client.remove(connId, "/tmp/a"),
      () => client.rename(connId, "/tmp/a", "/tmp/b"),
    ]) {
      const operation = start();
      respond(null);
      await expect(operation).resolves.toBeUndefined();
    }

    client.shellWrite(connId, "pwd\n");
    client.shellResize(connId, 120, 40);
    client.shellClose(connId);
    client.disconnect(connId);
    expect(socket.sent.map((item) => JSON.parse(item))).toEqual(
      expect.arrayContaining([
        { type: "shell-write", text: "pwd\n" },
        { type: "shell-resize", cols: 120, rows: 40 },
        { type: "shell-close" },
        { type: "disconnect" },
      ]),
    );
  });

  it("後端偵測到已保存指紋不一致時回傳可辨識的安全錯誤", async () => {
    const socket = new FakeWebSocket();
    const client = new BackendSshClient({
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const connected = client.connect(CONNECTION);
    socket.receive({
      type: "host-key-mismatch",
      expected: "SHA256:old",
      actual: "SHA256:new",
      keyType: "ssh-ed25519",
    });
    socket.receive({ type: "state", state: "error" });

    await expect(connected).rejects.toBeInstanceOf(BackendHostKeyMismatchError);
  });

  it("關閉事件會通知生命週期，且連線前也能主動 close", async () => {
    const socket = new FakeWebSocket();
    const client = new BackendSshClient({
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const onClosed = vi.fn();
    client.onClosed(onClosed);

    const connected = client.connect(CONNECTION);
    client.close();

    await expect(connected).rejects.toThrow("已關閉");
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("已就緒工作階段異常關閉時最多依 1/2/4 秒策略重連，成功後不通知永久關閉", async () => {
    const sockets: FakeWebSocket[] = [];
    const delays: number[] = [];
    const states: unknown[] = [];
    const client = new BackendSshClient({
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelaysMs: [1_000, 2_000, 4_000],
      delay: async (ms) => { delays.push(ms); },
    });
    const onClosed = vi.fn();
    client.onClosed(onClosed);
    client.onReconnectState((state) => states.push(state));

    const connected = client.connect(CONNECTION);
    sockets[0]!.receive({ type: "state", state: "ready" });
    await connected;
    sockets[0]!.close(1011);

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(delays).toEqual([1_000]);
    client.shellWrite(1, "must-not-buffer");
    expect(sockets[1]!.sent).toEqual([]);
    sockets[1]!.receive({ type: "state", state: "ready" });
    await vi.waitFor(() => expect(states).toContainEqual({ state: "ready", attempt: 1 }));
    expect(onClosed).not.toHaveBeenCalled();
    expect(states).toContainEqual({ state: "reconnecting", attempt: 1, delayMs: 1_000 });
  });

  it("三次重連都失敗後才通知永久關閉，明確 disconnect 不重連", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = new BackendSshClient({
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelaysMs: [0, 0, 0],
      delay: async () => undefined,
    });
    const onClosed = vi.fn();
    client.onClosed(onClosed);

    const connected = client.connect(CONNECTION);
    sockets[0]!.receive({ type: "state", state: "ready" });
    await connected;
    sockets[0]!.close(1011);
    for (let expected = 2; expected <= 4; expected += 1) {
      await vi.waitFor(() => expect(sockets).toHaveLength(expected));
      sockets[expected - 1]!.close(1011);
    }
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());

    const explicitSockets: FakeWebSocket[] = [];
    const explicit = new BackendSshClient({
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        explicitSockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelaysMs: [0, 0, 0],
      delay: async () => undefined,
    });
    const explicitConnected = explicit.connect(CONNECTION);
    explicitSockets[0]!.receive({ type: "state", state: "ready" });
    const connId = await explicitConnected;
    explicit.disconnect(connId);
    await Promise.resolve();
    expect(explicitSockets).toHaveLength(1);
  });

  it("動態重連設定只影響下一次異常斷線，停用時不建立新 socket", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = new BackendSshClient({
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      delay: async () => undefined,
    });
    const onClosed = vi.fn();
    client.onClosed(onClosed);
    const connected = client.connect(CONNECTION);
    sockets[0]!.receive({ type: "state", state: "ready" });
    await connected;

    client.setReconnectPolicy(false, 5);
    sockets[0]!.close(1011);
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(sockets).toHaveLength(1);
  });

  it("動態重連次數依 1/2/4/8/16 秒策略截取", async () => {
    const sockets: FakeWebSocket[] = [];
    const delays: number[] = [];
    const client = new BackendSshClient({
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      delay: async (ms) => { delays.push(ms); },
    });
    const onClosed = vi.fn();
    client.onClosed(onClosed);
    const connected = client.connect(CONNECTION);
    sockets[0]!.receive({ type: "state", state: "ready" });
    await connected;

    client.setReconnectPolicy(true, 2);
    sockets[0]!.close(1011);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.close(1011);
    await vi.waitFor(() => expect(sockets).toHaveLength(3));
    sockets[2]!.close(1011);
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(delays).toEqual([1_000, 2_000]);
  });

  it("SFTP readFile 逐塊讀取並組合，writeFile 以 512 KiB 分塊送出", async () => {
    const socket = new FakeWebSocket();
    const client = new BackendSshClient({
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connected = client.connect(CONNECTION);
    socket.receive({ type: "state", state: "ready" });
    const connId = await connected;

    const readPromise = client.readFile(connId, "/tmp/large.bin");
    let request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    expect(request.method).toBe("sftpOpenRead");
    socket.receive({ type: "response", id: request.id, ok: true, result: { handleId: 31, size: 3 } });
    await Promise.resolve();
    request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    expect(request.method).toBe("sftpReadChunk");
    socket.receive({ type: "response", id: request.id, ok: true, result: { base64: "YWI=", eof: false } });
    await Promise.resolve();
    request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    socket.receive({ type: "response", id: request.id, ok: true, result: { base64: "Yw==", eof: true } });
    await Promise.resolve();
    request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    expect(request.method).toBe("sftpCloseRead");
    socket.receive({ type: "response", id: request.id, ok: true, result: null });
    await expect(readPromise).resolves.toEqual(new TextEncoder().encode("abc"));

    const data = new Uint8Array(512 * 1024 + 3);
    data.fill(7);
    const writePromise = client.writeFile(connId, "/tmp/large.bin", data);
    request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    expect(request.method).toBe("sftpOpenWrite");
    socket.receive({ type: "response", id: request.id, ok: true, result: { handleId: 32 } });
    await Promise.resolve();

    const chunkSizes: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const chunkRequest = JSON.parse(socket.sent.at(-1)!) as {
        id: string;
        method: string;
        params?: { base64?: string };
      };
      expect(chunkRequest.method).toBe("sftpWriteChunk");
      chunkSizes.push(atob(chunkRequest.params!.base64!).length);
      socket.receive({ type: "response", id: chunkRequest.id, ok: true, result: null });
      await Promise.resolve();
    }
    request = JSON.parse(socket.sent.at(-1)!) as { id: string; method: string };
    expect(request.method).toBe("sftpCloseWrite");
    socket.receive({ type: "response", id: request.id, ok: true, result: null });
    await expect(writePromise).resolves.toBeUndefined();
    expect(chunkSizes).toEqual([512 * 1024, 3]);
  });
});
