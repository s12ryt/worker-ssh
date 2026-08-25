import { describe, expect, it, vi } from "vitest";
import { BackendSshRuntime } from "../../../src/worker/backend-ssh-runtime";

describe("BackendSshRuntime", () => {
  it("同一 isolate 只啟動一次 Go WASM 並共用引擎", async () => {
    const engine = { connect: vi.fn() };
    const registry: { sshEngine?: unknown } = {};
    const run = vi.fn(async () => {
      registry.sshEngine = engine;
      await new Promise(() => undefined);
    });
    const instantiate = vi.fn(async () => ({ instance: {} as WebAssembly.Instance }));
    const createGo = vi.fn(() => ({ importObject: {}, run }));
    const runtime = new BackendSshRuntime({
      module: {} as WebAssembly.Module,
      registry,
      createGo,
      instantiate,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    const [first, second] = await Promise.all([runtime.load(), runtime.load()]);

    expect(first).toBe(engine);
    expect(second).toBe(engine);
    expect(createGo).toHaveBeenCalledTimes(1);
    expect(instantiate).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("啟動失敗不永久快取 rejection，下一次可重試", async () => {
    const engine = { connect: vi.fn() };
    const registry: { sshEngine?: unknown } = {};
    const instantiate = vi
      .fn()
      .mockRejectedValueOnce(new Error("wasm unavailable"))
      .mockResolvedValue({ instance: {} as WebAssembly.Instance });
    const createGo = vi.fn(() => ({
      importObject: {},
      run: async () => {
        registry.sshEngine = engine;
        await new Promise(() => undefined);
      },
    }));
    const runtime = new BackendSshRuntime({
      module: {} as WebAssembly.Module,
      registry,
      createGo,
      instantiate,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(runtime.load()).rejects.toThrow("wasm unavailable");
    await expect(runtime.load()).resolves.toBe(engine);
    expect(instantiate).toHaveBeenCalledTimes(2);
  });

  it("接受 WebAssembly.instantiate 對已編譯 Module 回傳的 Instance 形狀", async () => {
    const instance = {} as WebAssembly.Instance;
    const engine = { connect: vi.fn() };
    const registry: { sshEngine?: unknown } = {};
    const run = vi.fn(async () => {
      registry.sshEngine = engine;
      await new Promise(() => undefined);
    });
    const runtime = new BackendSshRuntime({
      module: {} as WebAssembly.Module,
      registry,
      createGo: () => ({ importObject: {}, run }),
      instantiate: async () => instance,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(runtime.load()).resolves.toBe(engine);
    expect(run).toHaveBeenCalledWith(instance);
  });
});
