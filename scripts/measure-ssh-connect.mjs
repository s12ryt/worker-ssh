// SSH 連線時間量測腳本（基礎設施工具，非正式產品碼）。
// 口徑：點擊連線(t0) → terminal 可輸入(第一條 shell-data)，
//       忠實模擬 src/frontend/main.ts connectTo() 的後端往返序列：
//       WS 建立 → state ready → OS 偵測(KV→exec) → openShell → shell banner。
// Node 原生 WebSocket 不支援自訂 headers，故內建最小 RFC 6455 client。
// 前提：wrangler dev (127.0.0.1:8787) 與 dev-ssh-server (127.0.0.1:2222) 運行中。
// 用法：node scripts/measure-ssh-connect.mjs [--iterations 10] [--warmup 1]
//         [--base http://127.0.0.1:8787] [--json] [--label baseline]
import { readFileSync } from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const BASE = arg("base", "http://127.0.0.1:8787");
const WS_BASE = BASE.replace(/^http/, "ws");
const ITERATIONS = Number(arg("iterations", 10));
const WARMUP = Number(arg("warmup", 1));
const LABEL = arg("label", "run");
const AS_JSON = Boolean(arg("json", false));
const ITERATION_GAP_MS = 600;

// ---- 最小 WebSocket client（僅支援文字幀，量測用途） ----

class MiniWebSocket {
  constructor(socket, head) {
    this.socket = socket;
    this.buffer = Buffer.from(head ?? Buffer.alloc(0));
    this.fragments = [];
    this.messageHandlers = new Set();
    this.closeHandlers = new Set();
    this.closed = false;
    this.closePromise = new Promise((resolve) => {
      this.closeResolve = resolve;
    });
    socket.on("data", (chunk) => this.feed(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", () => this.handleClose());
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.parseFrame();
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.consumed);
      this.consumeFrame(frame);
    }
  }

  parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return null;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(16 * 1024 * 1024)) throw new Error("WebSocket 幀過大");
      length = Number(big);
      offset = 10;
    }
    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + length) return null;
    let payload = buf.subarray(offset, offset + length);
    if (mask) {
      const unmasked = Buffer.from(payload);
      for (let i = 0; i < unmasked.length; i += 1) unmasked[i] ^= mask[i % 4];
      payload = unmasked;
    }
    return { fin, opcode, payload, consumed: offset + length };
  }

  consumeFrame(frame) {
    switch (frame.opcode) {
      case 0x0: // continuation
      case 0x1: // text
        this.fragments.push(frame.payload);
        if (frame.fin) {
          const text = Buffer.concat(this.fragments).toString("utf8");
          this.fragments = [];
          for (const handler of [...this.messageHandlers]) handler(text);
        }
        return;
      case 0x8: // close
        try {
          this.sendRaw(0x8, Buffer.alloc(0));
        } catch {
          /* 忽略 */
        }
        this.socket.destroy();
        this.handleClose();
        return;
      case 0x9: // ping → pong
        this.sendRaw(0xa, frame.payload);
        return;
      default:
        return; // binary 等不使用
    }
  }

  sendRaw(opcode, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(text) {
    this.sendRaw(0x1, Buffer.from(text, "utf8"));
  }

  close() {
    if (this.closed) return;
    try {
      this.sendRaw(0x8, Buffer.alloc(0));
    } catch {
      /* 忽略 */
    }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 500).unref();
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.closeHandlers) handler();
    this.closeResolve();
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
  }

  offMessage(handler) {
    this.messageHandlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
  }
}

function wsConnect(urlString, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      host: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        ...headers,
      },
    });
    req.on("response", (res) => {
      res.resume();
      reject(new Error(`WebSocket 被拒：HTTP ${res.statusCode}`));
    });
    req.on("upgrade", (res, socket, head) => {
      resolve(new MiniWebSocket(socket, head));
    });
    req.on("error", reject);
    req.end();
  });
}

// ---- 面板 API ----

function devPassword() {
  const explicit = arg("password", "");
  if (typeof explicit === "string" && explicit) return explicit;
  const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const match = text.match(/^PANEL_PASSWORD=(.+)$/m);
  if (!match) throw new Error("找不到 PANEL_PASSWORD（.dev.vars 或 --password）");
  return match[1].trim();
}

async function api(path, init) {
  return fetch(`${BASE}${path}`, init);
}

async function login() {
  const response = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: devPassword() }),
  });
  if (!response.ok) throw new Error(`登入失敗：${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("登入回應缺少 Set-Cookie");
  return cookie;
}

async function ensureBenchConnection(cookie) {
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  const listResponse = await api("/api/connections", { headers });
  if (!listResponse.ok) {
    throw new Error(`取得連線列表失敗：${listResponse.status}`);
  }
  const list = await listResponse.json();
  const connections = Array.isArray(list) ? list : list.connections ?? [];
  const existing = connections.find(
    (c) => c.host === "127.0.0.1" && c.port === 2222 && c.username === "tester",
  );
  if (existing) {
    if (existing.credentialState === "ready") return existing.id;
    const patch = await api(
      `/api/connections/${encodeURIComponent(existing.id)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          authType: "password",
          password: "secret-pass",
        }),
      },
    );
    if (!patch.ok) throw new Error(`補上憑證失敗：${patch.status}`);
    return existing.id;
  }
  const created = await api("/api/connections", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "ssh-bench",
      host: "127.0.0.1",
      port: 2222,
      username: "tester",
      authType: "password",
      password: "secret-pass",
    }),
  });
  if (created.status !== 201) {
    throw new Error(`建立連線失敗：${created.status}`);
  }
  return (await created.json()).id;
}

async function clearHostKey(cookie, connectionId) {
  await api(`/api/connections/${encodeURIComponent(connectionId)}`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hostKeyFingerprint: null, hostKeyType: null }),
  });
}

// ---- 單次連線量測 ----

// 模擬 detectOs：KV 查詢（快取命中路徑）；miss 時 exec + 背景 PUT（不等待）。
// cachedResponse 為與 WS 連線並行預先發出的請求（模擬前端 connectTo 的預熱）。
async function detectOsStage(cookie, request, key, timings, mark, cachedResponsePromise) {
  const cachedResponse = await cachedResponsePromise;
  if (cachedResponse.ok) {
    await cachedResponse.json();
    timings[mark] = performance.now();
    return "kv-hit";
  }
  await cachedResponse.json().catch(() => undefined);
  await request("exec", { command: "cat /etc/os-release" });
  timings[mark] = performance.now();
  void api("/api/os", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      info: { family: "linux", os: "Ubuntu", version: "24.04" },
    }),
  }).catch(() => undefined);
  return "kv-miss";
}

async function runIteration(cookie, connectionId) {
  const t = { t0: performance.now() };
  // OS KV 讀取與 WS 連線並行預熱（模擬前端 connectTo）
  const osKey = "127.0.0.1:2222";
  const osPrefetch = api(`/api/os?key=${encodeURIComponent(osKey)}`, {
    headers: { Cookie: cookie },
  });
  const socket = await wsConnect(
    `${WS_BASE}/api/ssh?connectionId=${encodeURIComponent(connectionId)}`,
    { cookie },
  );
  let sawMismatch = false;
  let requestSequence = 0;
  const pending = new Map();

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `m${++requestSequence}`;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ type: "request", id, method, params }));
    });

  socket.onMessage((text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === "host-key") {
      socket.send(
        JSON.stringify({
          type: "host-key-response",
          challengeId: message.challengeId,
          accepted: true,
        }),
      );
      return;
    }
    if (message.type === "host-key-mismatch") {
      sawMismatch = true;
      return;
    }
    if (message.type === "response") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(`RPC ${message.id} 失敗`));
    }
  });

  const waitState = (state) =>
    new Promise((resolve, reject) => {
      const handler = (text) => {
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.type === "state" && message.state === state) {
          socket.offMessage(handler);
          resolve();
        } else if (message.type === "state" && message.state === "error") {
          socket.offMessage(handler);
          reject(
            new Error(sawMismatch ? "host-key-mismatch" : "後端 SSH state=error"),
          );
        }
      };
      socket.onMessage(handler);
      socket.onClose(() => {
        socket.offMessage(handler);
        reject(
          new Error(sawMismatch ? "host-key-mismatch" : "WebSocket 提前關閉"),
        );
      });
    });

  try {
    t.t1 = performance.now(); // WS 已建立（upgrade 完成）
    await waitState("ready"); // TCP+WASM 載入+SSH handshake+auth+TOFU
    t.t2 = performance.now();
    const osSource = await detectOsStage(
      cookie,
      request,
      osKey,
      t,
      "t3",
      osPrefetch,
    );
    await request("openShell", { cols: 80, rows: 24 });
    t.t4 = performance.now();
    await new Promise((resolve) => {
      const handler = (text) => {
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.type === "shell-data") {
          socket.offMessage(handler);
          resolve();
        }
      };
      socket.onMessage(handler);
    });
    t.t5 = performance.now();
    return {
      s1_ws: t.t1 - t.t0,
      s2_ssh: t.t2 - t.t1,
      s3_os: t.t3 - t.t2,
      s4_shellRpc: t.t4 - t.t3,
      s5_firstData: t.t5 - t.t4,
      total: t.t5 - t.t0,
      osSource,
    };
  } finally {
    try {
      socket.send(JSON.stringify({ type: "disconnect" }));
    } catch {
      /* 忽略 */
    }
    socket.close();
    await socket.closePromise.catch(() => undefined);
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
  return {
    min: sorted[0],
    median: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}

async function withMismatchRetry(cookie, connectionId, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.message === "host-key-mismatch") {
      await clearHostKey(cookie, connectionId);
      return fn();
    }
    throw error;
  }
}

async function main() {
  const cookie = await login();
  const connectionId = await ensureBenchConnection(cookie);

  for (let i = 0; i < WARMUP; i += 1) {
    const result = await withMismatchRetry(cookie, connectionId, () =>
      runIteration(cookie, connectionId),
    );
    if (!AS_JSON) {
      console.log(
        `[warmup ${i + 1}/${WARMUP}] total=${result.total.toFixed(1)}ms os=${result.osSource}`,
      );
    }
    await new Promise((r) => setTimeout(r, ITERATION_GAP_MS));
  }

  const results = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const result = await withMismatchRetry(cookie, connectionId, () =>
      runIteration(cookie, connectionId),
    );
    results.push(result);
    if (!AS_JSON) {
      console.log(
        `[${String(i + 1).padStart(2)}/${ITERATIONS}] ws=${result.s1_ws.toFixed(0)}ms` +
          ` ssh=${result.s2_ssh.toFixed(0)}ms os=${result.s3_os.toFixed(0)}ms(${result.osSource})` +
          ` shellRpc=${result.s4_shellRpc.toFixed(0)}ms firstData=${result.s5_firstData.toFixed(0)}ms` +
          ` TOTAL=${result.total.toFixed(0)}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, ITERATION_GAP_MS));
  }

  const summary = {
    label: LABEL,
    iterations: results.length,
    s1_ws: stats(results.map((r) => r.s1_ws)),
    s2_ssh: stats(results.map((r) => r.s2_ssh)),
    s3_os: stats(results.map((r) => r.s3_os)),
    s4_shellRpc: stats(results.map((r) => r.s4_shellRpc)),
    s5_firstData: stats(results.map((r) => r.s5_firstData)),
    total: stats(results.map((r) => r.total)),
  };
  if (AS_JSON) {
    console.log(JSON.stringify(summary));
  } else {
    console.log("\n===== 統計（ms）=====");
    for (const [key, value] of Object.entries(summary)) {
      if (typeof value === "object") {
        console.log(
          `${key.padEnd(12)} median=${value.median.toFixed(1)} p95=${value.p95.toFixed(1)} min=${value.min.toFixed(1)} max=${value.max.toFixed(1)}`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(`量測失敗：${error.message}`);
  process.exitCode = 1;
});
