import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBackendConnectionConfig,
  OneTimeSessionInit,
  SESSION_INIT_TTL_MS,
} from "../../../src/worker/backend-ssh-do";

afterEach(() => {
  vi.useRealTimers();
});

describe("SshSessionObject private init guard", () => {
  const valid = {
    id: "conn-1",
    name: "Fixture",
    host: "127.0.0.1",
    port: 2222,
    username: "tester",
    authType: "password" as const,
    password: "secret-pass",
    createdAt: 1,
    updatedAt: 1,
  };

  it("只接受具備相符憑證的完整內部連線設定", () => {
    expect(isBackendConnectionConfig(valid)).toBe(true);
    expect(isBackendConnectionConfig({ ...valid, password: undefined })).toBe(false);
    expect(
      isBackendConnectionConfig({
        ...valid,
        authType: "privateKey",
        password: undefined,
        privateKey: "PRIVATE KEY",
      }),
    ).toBe(true);
    expect(isBackendConnectionConfig({ ...valid, port: 0 })).toBe(false);
  });
});

describe("SshSessionObject 一次性初始化 nonce", () => {
  it("nonce 僅能消耗一次，錯誤 nonce 不得取得設定", () => {
    const slot = new OneTimeSessionInit<{ secret: string }>({
      nonceFactory: () => "nonce-1",
    });

    expect(slot.initialize({ secret: "memory-only" })).toBe("nonce-1");
    expect(slot.consume("wrong-nonce")).toBeNull();
    expect(slot.consume("nonce-1")).toEqual({ secret: "memory-only" });
    expect(slot.consume("nonce-1")).toBeNull();
  });

  it("10 秒後自動清除尚未連線的設定", () => {
    vi.useFakeTimers();
    expect(SESSION_INIT_TTL_MS).toBe(10_000);
    const slot = new OneTimeSessionInit<{ secret: string }>({
      nonceFactory: () => "nonce-expiring",
    });
    slot.initialize({ secret: "must-expire" });

    vi.advanceTimersByTime(SESSION_INIT_TTL_MS);

    expect(slot.consume("nonce-expiring")).toBeNull();
  });
});
