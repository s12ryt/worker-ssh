import { describe, expect, it, vi } from "vitest";
import {
  LoginRateLimiter,
  loginSourceOf,
} from "../../../src/worker/login-rate-limit";

function createKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  } as unknown as KVNamespace;
}

describe("LoginRateLimiter", () => {
  it("第 5 次失敗後封鎖至 15 分鐘固定窗口結束", async () => {
    let now = 1_000_000;
    const limiter = new LoginRateLimiter(createKv(), () => now);

    await expect(limiter.check("198.51.100.1")).resolves.toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.recordFailure("198.51.100.1");
    }
    await expect(limiter.check("198.51.100.1")).resolves.toEqual({
      limited: true,
      retryAfterSeconds: 900,
    });

    now += 15 * 60 * 1000;
    await expect(limiter.check("198.51.100.1")).resolves.toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  it("clear 會移除來源的失敗計數", async () => {
    const limiter = new LoginRateLimiter(createKv(), () => 2_000_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.recordFailure("198.51.100.2");
    }
    await limiter.clear("198.51.100.2");

    await expect(limiter.check("198.51.100.2")).resolves.toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });
});

describe("loginSourceOf", () => {
  it("使用 CF-Connecting-IP，缺少時回傳穩定且非空的 fallback", () => {
    expect(
      loginSourceOf(
        new Request("https://example.com", {
          headers: { "CF-Connecting-IP": " 203.0.113.20 " },
        }),
      ),
    ).toBe("203.0.113.20");

    const first = loginSourceOf(new Request("https://example.com"));
    const second = loginSourceOf(new Request("https://example.com/other"));
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});
