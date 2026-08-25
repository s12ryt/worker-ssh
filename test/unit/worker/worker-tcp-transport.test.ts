import { describe, expect, it, vi } from "vitest";
import {
  WorkerTcpTransport,
  type WorkerSocketLike,
} from "../../../src/worker/worker-tcp-transport";

interface FakeSocketHandle {
  socket: WorkerSocketLike;
  open(): void;
  push(data: Uint8Array): void;
  end(): void;
  writes: number[][];
  releaseWrite(): void;
}

function fakeSocket(stallWrites = false): FakeSocketHandle {
  let openSocket!: () => void;
  let readController!: ReadableStreamDefaultController<Uint8Array>;
  let releaseWrite: () => void = () => undefined;
  const writes: number[][] = [];
  const opened = new Promise<void>((resolve) => {
    openSocket = resolve;
  });
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readController = controller;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      writes.push([...chunk]);
      if (stallWrites) {
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      }
    },
  });
  return {
    socket: {
      opened,
      readable,
      writable,
      close: vi.fn(async () => undefined),
    },
    open: openSocket,
    push: (data) => readController.enqueue(data),
    end: () => readController.close(),
    writes,
    releaseWrite: () => releaseWrite(),
  };
}

describe("WorkerTcpTransport", () => {
  it("轉交 opened/data/closed 並保序寫入 Worker socket", async () => {
    const fake = fakeSocket();
    const transport = new WorkerTcpTransport(fake.socket);
    const opened = vi.fn();
    const data = vi.fn();
    const closed = vi.fn();
    transport.onOpen(opened);
    transport.onData(data);
    transport.onClosed(closed);

    transport.send(new Uint8Array([1]));
    transport.send(new Uint8Array([2, 3]));
    fake.open();
    fake.push(new Uint8Array([9, 8]));
    fake.end();
    await transport.settled();

    expect(opened).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledWith(new Uint8Array([9, 8]));
    expect(fake.writes).toEqual([[1], [2, 3]]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(transport.closeError()).toBeNull();
  });

  it("同步送入超過有界佇列時關閉並回報錯誤", async () => {
    const fake = fakeSocket(true);
    const transport = new WorkerTcpTransport(fake.socket, { maxQueuedBytes: 2 });
    const closed = vi.fn();
    transport.onClosed(closed);
    fake.open();

    transport.send(new Uint8Array([1, 2]));
    transport.send(new Uint8Array([3]));
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));

    expect(transport.closeError()).toContain("佇列上限");
    expect(fake.socket.close).toHaveBeenCalledTimes(1);
    fake.releaseWrite();
  });

  it("disposeCallbacks 後延遲事件不再呼叫 Go callback", async () => {
    const fake = fakeSocket();
    const transport = new WorkerTcpTransport(fake.socket);
    const opened = vi.fn();
    const data = vi.fn();
    const closed = vi.fn();
    transport.onOpen(opened);
    transport.onData(data);
    transport.onClosed(closed);
    transport.disposeCallbacks();

    fake.open();
    fake.push(new Uint8Array([7]));
    fake.end();
    await transport.settled();

    expect(opened).not.toHaveBeenCalled();
    expect(data).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it("Go 尚未註冊 onData 前的早期讀取超過上限會關閉 socket", async () => {
    const fake = fakeSocket();
    const transport = new WorkerTcpTransport(fake.socket, {
      maxBufferedReadBytes: 2,
    });
    const closed = vi.fn();
    transport.onClosed(closed);

    fake.push(new Uint8Array([1, 2]));
    fake.push(new Uint8Array([3]));
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));

    expect(transport.closeError()).toContain("TCP 讀取緩衝上限");
    expect(fake.socket.close).toHaveBeenCalledTimes(1);
  });

  it("註冊 onData 會送出早期資料並清空讀取緩衝計數", async () => {
    const fake = fakeSocket();
    const transport = new WorkerTcpTransport(fake.socket, {
      maxBufferedReadBytes: 2,
    });
    const data = vi.fn();

    fake.open();
    fake.push(new Uint8Array([1, 2]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.onData(data);
    fake.push(new Uint8Array([3, 4]));
    fake.end();
    await transport.settled();

    expect(data.mock.calls.map(([chunk]) => [...chunk])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(transport.closeError()).toBeNull();
  });
});
