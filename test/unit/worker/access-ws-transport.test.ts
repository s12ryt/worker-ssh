import { describe, expect, it, vi } from "vitest";
import { AccessWebSocketTransport } from "../../../src/worker/access-ws-transport";
import type { AccessProxyConfig } from "../../../src/shared/types";

/**
 * AccessWebSocketTransport 契約：
 * - 建構即對 https://<hostname>/ 發起 WebSocket 升級 fetch，
 *   帶 CF-Access-Client-Id/CF-Access-Client-Secret（service token），
 *   bastion 模式加 Cf-Access-Jump-Destination。
 * - 實作 Go NewWsConn 所需 transport 介面：
 *   onOpen/onData/onClosed/send/closeError/disposeCallbacks/close。
 * - open 前收到的資料需緩衝，onData 註冊後補送。
 * - fetch 失敗或 WS 異常關閉時以 closeError 描述原因。
 */

const BASE: AccessProxyConfig = {
  hostname: "ssh.example.com",
  clientId: "cid-1",
  clientSecret: "secret-1",
};

function pair() {
  const p = new WebSocketPair();
  return { client: p[0], server: p[1] };
}

function okFetch(ws: WebSocket) {
  return vi.fn(async () => new Response(null, { status: 101, webSocket: ws }));
}

function bytesOf(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function nextMessage(ws: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event: MessageEvent) => {
      resolve(bytesOf(event.data as ArrayBuffer));
    });
  });
}

function stateOf(ws: WebSocket): Promise<"open" | "closed"> {
  return new Promise((resolve) => {
    if (ws.readyState === 1) return resolve("open");
    ws.addEventListener("open", () => resolve("open"));
    ws.addEventListener("close", () => resolve("closed"));
  });
}

describe("AccessWebSocketTransport", () => {
  it("建構時以正確 URL 與 Access headers 發起升級", async () => {
    const { client } = pair();
    const fetcher = okFetch(client);
    new AccessWebSocketTransport(
      { ...BASE, destination: "10.0.0.5:2222" },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://ssh.example.com/");
    const headers = init.headers as Record<string, string>;
    expect(headers["Upgrade"]).toBe("websocket");
    expect(headers["CF-Access-Client-Id"]).toBe("cid-1");
    expect(headers["CF-Access-Client-Secret"]).toBe("secret-1");
    expect(headers["Cf-Access-Jump-Destination"]).toBe("10.0.0.5:2222");
  });

  it("無 service token 時不帶 CF-Access headers；無 destination 時不帶 Jump header", async () => {
    const { client } = pair();
    const fetcher = okFetch(client);
    new AccessWebSocketTransport(
      { hostname: "t.example.com" },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    await new Promise((r) => setTimeout(r, 10));

    const [, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("CF-Access-Client-Id");
    expect(headers).not.toHaveProperty("CF-Access-Client-Secret");
    expect(headers).not.toHaveProperty("Cf-Access-Jump-Destination");
  });

  it("雙向資料流：onData 收 binary、send 送 binary", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);

    const received: Uint8Array[] = [];
    const got = new Promise<void>((r) => {
      transport.onData((data) => {
        received.push(data);
        r();
      });
    });
    server.send(new Uint8Array([1, 2, 3]));
    await got;
    expect(received[0]).toEqual(new Uint8Array([1, 2, 3]));

    const echoed = nextMessage(server);
    transport.send(new Uint8Array([9, 8, 7]));
    expect(await echoed).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("onData 註冊前收到的資料會緩衝補送", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);
    server.send(new Uint8Array([7, 7, 7]));
    await new Promise((r) => setTimeout(r, 10));

    const buffered: Uint8Array[] = [];
    transport.onData((data) => buffered.push(data));
    expect(buffered).toEqual([new Uint8Array([7, 7, 7])]);
  });

  it("onOpen 在 WS 開啟後觸發（建構後才註冊亦然）", async () => {
    const { client } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    let opened = false;
    transport.onOpen(() => {
      opened = true;
    });
    await vi.waitFor(() => expect(opened).toBe(true));
  });

  it("fetch 非 101（無 webSocket）→ onClosed 且 closeError 描述狀態碼", async () => {
    const fetcher = vi.fn(
      async () => new Response("denied", { status: 403 }),
    );
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: fetcher as unknown as typeof fetch,
    });
    let closed = false;
    transport.onClosed(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(transport.closeError()).toContain("403");
  });

  it("fetch 拒絕 → onClosed 且 closeError 含失敗訊息", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: fetcher as unknown as typeof fetch,
    });
    let closed = false;
    transport.onClosed(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(transport.closeError()).toContain("network unreachable");
  });

  it("對側正常關閉 → onClosed 且 closeError 為 null（EOF 語意）", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);
    let closed = false;
    transport.onClosed(() => {
      closed = true;
    });
    server.close(1000);
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(transport.closeError()).toBeNull();
  });

  it("對側異常關閉（1011）→ closeError 含 code 與 reason", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);
    let closed = false;
    transport.onClosed(() => {
      closed = true;
    });
    server.close(1011, "access denied");
    await vi.waitFor(() => expect(closed).toBe(true));
    const message = transport.closeError() ?? "";
    expect(message).toContain("1011");
    expect(message).toContain("access denied");
  });

  it("close() 主動關閉：對側收到 close、重複 close 無害", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);
    const serverClosed = new Promise<void>((r) => {
      server.addEventListener("close", () => r());
    });
    let closed = false;
    transport.onClosed(() => {
      closed = true;
    });
    transport.close();
    transport.close();
    await serverClosed;
    expect(closed).toBe(true);
    expect(transport.closeError()).toBeNull();
  });

  it("disposeCallbacks 後不再觸發回呼並丟棄緩衝", async () => {
    const { client, server } = pair();
    const transport = new AccessWebSocketTransport(BASE, {
      fetcher: okFetch(client) as unknown as typeof fetch,
    });
    server.accept();
    await stateOf(client);
    server.send(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 10));

    transport.disposeCallbacks();
    let called = false;
    transport.onData(() => {
      called = true;
    });
    expect(called).toBe(false);

    let closedCalled = false;
    transport.onClosed(() => {
      closedCalled = true;
    });
    server.close(1000);
    await new Promise((r) => setTimeout(r, 10));
    expect(closedCalled).toBe(false);
  });
});
