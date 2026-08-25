import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBackendConnectionConfig,
  parseSessionConfigHeader,
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

  it("接受附帶 sshOptions 的設定；項目形狀錯誤時拒絕", () => {
    expect(
      isBackendConnectionConfig({
        ...valid,
        sshOptions: [{ key: "ServerAliveInterval", value: "60" }],
      }),
    ).toBe(true);
    expect(
      isBackendConnectionConfig({
        ...valid,
        sshOptions: [{ key: "ServerAliveInterval" }],
      }),
    ).toBe(false);
    expect(
      isBackendConnectionConfig({
        ...valid,
        sshOptions: [{ value: "60" }],
      }),
    ).toBe(false);
    expect(
      isBackendConnectionConfig({ ...valid, sshOptions: "ServerAliveInterval=60" }),
    ).toBe(false);
  });

  it("接受附帶 accessProxy 的設定（clientSecret 必須在）；形狀錯誤拒絕", () => {
    expect(
      isBackendConnectionConfig({
        ...valid,
        accessProxy: {
          hostname: "loc-ssh.czy-cf.eu.cc",
          clientId: "cid",
          clientSecret: "secret",
        },
      }),
    ).toBe(true);
    expect(
      isBackendConnectionConfig({
        ...valid,
        accessProxy: { hostname: "loc-ssh.czy-cf.eu.cc" },
      }),
    ).toBe(true);
    expect(
      isBackendConnectionConfig({
        ...valid,
        accessProxy: { hostname: "", clientId: "cid", clientSecret: "s" },
      }),
    ).toBe(false);
    expect(
      isBackendConnectionConfig({
        ...valid,
        accessProxy: {
          hostname: "h.example.com",
          clientId: "cid",
          clientSecret: "",
        },
      }),
    ).toBe(false);
    expect(isBackendConnectionConfig({ ...valid, accessProxy: "h" })).toBe(
      false,
    );
  });
});

describe("SshSessionObject connect header 解析", () => {
  const sessionInit = {
    config: {
      id: "conn-1",
      name: "Fixture",
      host: "127.0.0.1",
      port: 2222,
      username: "tester",
      authType: "password" as const,
      password: "secret-pass",
      createdAt: 1,
      updatedAt: 1,
    },
    quota: { sessionKey: "key-1", leaseId: "lease-1" },
  };

  it("合法 X-Session-Config 可解回完整 session init（含非 ASCII）", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(sessionInit));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const header = btoa(bin);
    expect(parseSessionConfigHeader(header)).toEqual(sessionInit);
  });

  it("缺 header、壞 base64、非法 payload 一律回 null", () => {
    expect(parseSessionConfigHeader(null)).toBeNull();
    expect(parseSessionConfigHeader("")).toBeNull();
    expect(parseSessionConfigHeader("!!!not-base64!!!")).toBeNull();
    expect(parseSessionConfigHeader(btoa("not-json"))).toBeNull();
    expect(parseSessionConfigHeader(btoa(JSON.stringify({ config: 1 })))).toBeNull();
  });
});
