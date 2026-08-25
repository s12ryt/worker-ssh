import { describe, expect, it } from "vitest";
import { normalizeSshHostname } from "../../../src/worker/ssh-host";

describe("normalizeSshHostname", () => {
  it("保留 IPv4 與域名原樣", () => {
    expect(normalizeSshHostname("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeSshHostname("example.com")).toBe("example.com");
    expect(normalizeSshHostname("ssh.example.com")).toBe("ssh.example.com");
  });

  it("保留裸 IPv6 位址原樣", () => {
    expect(normalizeSshHostname("::1")).toBe("::1");
    expect(normalizeSshHostname("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeSshHostname("fe80::1%eth0")).toBe("fe80::1%eth0");
  });

  it("移除 IPv6 字面位址的方括號", () => {
    expect(normalizeSshHostname("[::1]")).toBe("::1");
    expect(normalizeSshHostname("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("先去除前後空白再正規化", () => {
    expect(normalizeSshHostname("  127.0.0.1  ")).toBe("127.0.0.1");
    expect(normalizeSshHostname("  [::1]  ")).toBe("::1");
  });

  it("不完整的括號形式不視為括號位址", () => {
    expect(normalizeSshHostname("[::1")).toBe("[::1");
    expect(normalizeSshHostname("::1]")).toBe("::1]");
    expect(normalizeSshHostname("[]")).toBe("[]");
    expect(normalizeSshHostname("[[::1]]")).toBe("[[::1]]");
  });
});
