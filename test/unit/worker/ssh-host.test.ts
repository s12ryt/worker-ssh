import { describe, expect, it } from "vitest";
import { normalizeSshHostname } from "../../../src/worker/ssh-host";

/**
 * workerd `connect()` 實測契約（2026-08-26 本機 dev 以獨立 probe worker 驗證）：
 * - hostname `[::1]` → 連線成功（remoteAddress `[::1]:port`）
 * - hostname `::1`（裸）→ `proxy request failed, cannot connect`
 * 故 IPv6 字面位址必須以方括號形式傳給 connect()。
 */
describe("normalizeSshHostname", () => {
  it("保留 IPv4 與域名原樣", () => {
    expect(normalizeSshHostname("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeSshHostname("example.com")).toBe("example.com");
    expect(normalizeSshHostname("ssh.example.com")).toBe("ssh.example.com");
  });

  it("裸 IPv6 位址加上方括號（workerd connect 必需）", () => {
    expect(normalizeSshHostname("::1")).toBe("[::1]");
    expect(normalizeSshHostname("2001:db8::1")).toBe("[2001:db8::1]");
    expect(normalizeSshHostname("fe80::1%eth0")).toBe("[fe80::1%eth0]");
  });

  it("已帶方括號的 IPv6 位址保持方括號形式", () => {
    expect(normalizeSshHostname("[::1]")).toBe("[::1]");
    expect(normalizeSshHostname("[2001:db8::1]")).toBe("[2001:db8::1]");
  });

  it("先去除前後空白再正規化", () => {
    expect(normalizeSshHostname("  127.0.0.1  ")).toBe("127.0.0.1");
    expect(normalizeSshHostname("  [::1]  ")).toBe("[::1]");
    expect(normalizeSshHostname("  ::1  ")).toBe("[::1]");
  });

  it("混亂的括號形式統一修成單層方括號", () => {
    expect(normalizeSshHostname("[::1")).toBe("[::1]");
    expect(normalizeSshHostname("::1]")).toBe("[::1]");
    expect(normalizeSshHostname("[[::1]]")).toBe("[::1]");
    // 空內容不算位址，原樣保留
    expect(normalizeSshHostname("[]")).toBe("[]");
  });
});
