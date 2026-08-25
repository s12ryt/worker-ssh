import { describe, expect, it } from "vitest";
import { parseSshCommand } from "../../../src/frontend/ssh-command-import";

/**
 * ssh 指令匯入解析器契約：
 * - 貼上 `ssh [旗標] [user@]host [遠端指令]` 自動解析為連線表單欄位
 * - 支援 -o Key=Value（含黏形 -oKey=Value）、-p/-l（含黏形）、引號值
 * - ProxyCommand 僅 cloudflared access ssh 形態 → accessProxy（後者覆蓋前者）
 * - 不支援的旗標/選項/遠端指令不整體失敗，列入 warnings 盡量匯入
 * - 找不到主機、-p/-o 缺值、port 非法 → 整體失敗
 */

describe("parseSshCommand", () => {
  it("基本形：ssh root@192.168.1.10 → host/username/預設 port 22", () => {
    const result = parseSshCommand("ssh root@192.168.1.10");
    expect(result).toMatchObject({
      ok: true,
      value: {
        host: "192.168.1.10",
        port: 22,
        username: "root",
        sshOptions: [],
        warnings: [],
      },
    });
  });

  it("完整形：-o ×2、-p、-l、IPv6 主機", () => {
    const result = parseSshCommand(
      "ssh -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -p 2222 -l admin 2001:db8::1",
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        host: "2001:db8::1",
        port: 2222,
        username: "admin",
        sshOptions: [
          { key: "ServerAliveInterval", value: "60" },
          { key: "ServerAliveCountMax", value: "3" },
        ],
        warnings: [],
      },
    });
  });

  it("ProxyCommand 引號形含 service token → accessProxy（secret 保留供表單）", () => {
    const result = parseSshCommand(
      'ssh -o ProxyCommand="cloudflared access ssh --hostname loc-ssh.example.com --service-token-id cid-1 --service-token-secret sec-1" user@host.example.com',
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        host: "host.example.com",
        port: 22,
        username: "user",
        accessProxy: {
          hostname: "loc-ssh.example.com",
          clientId: "cid-1",
          clientSecret: "sec-1",
        },
        warnings: [],
      },
    });
  });

  it("重複 ProxyCommand 以後者覆蓋（OpenSSH -o 覆蓋語意）", () => {
    const result = parseSshCommand(
      "ssh -o ProxyCommand='cloudflared access ssh --hostname first.example.com' " +
        "-o ProxyCommand='cloudflared access ssh --hostname second.example.com' host",
    );
    expect(result).toMatchObject({
      ok: true,
      value: { accessProxy: { hostname: "second.example.com" } },
    });
  });

  it("不支援的 -o 鍵與非法值 → warnings 記錄並略過，其餘仍匯入", () => {
    const result = parseSshCommand(
      "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=abc -o Ciphers=aes128-gcm@openssh.com user@host",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.host).toBe("host");
    expect(result.value.username).toBe("user");
    expect(result.value.sshOptions).toEqual([
      { key: "Ciphers", value: "aes128-gcm@openssh.com" },
    ]);
    expect(result.value.warnings.join("\n")).toContain("StrictHostKeyChecking");
    expect(result.value.warnings.join("\n")).toContain("ConnectTimeout");
  });

  it("非 cloudflared 的 ProxyCommand → warning 不產生 accessProxy", () => {
    const result = parseSshCommand(
      "ssh -o ProxyCommand='nc %h %p' user@host",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.accessProxy).toBeUndefined();
    expect(result.value.warnings.join("\n")).toContain("ProxyCommand");
  });

  it("不支援旗標（-v、-i 需吞值、-W）與遠端指令 → warnings，位置參數仍正確", () => {
    const result = parseSshCommand(
      "ssh -v -i ~/.ssh/id_ed25519 -p 2222 -W jump:22 admin@10.0.0.5 ls -la",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.host).toBe("10.0.0.5");
    expect(result.value.username).toBe("admin");
    expect(result.value.port).toBe(2222);
    const text = result.value.warnings.join("\n");
    expect(text).toContain("-v");
    expect(text).toContain("-i");
    expect(text).toContain("-W");
    expect(text).toContain("ls");
  });

  it("黏形旗標 -oServerAliveInterval=30 -p2222 一樣可用", () => {
    const result = parseSshCommand("ssh -oServerAliveInterval=30 -p2222 h");
    expect(result).toMatchObject({
      ok: true,
      value: {
        host: "h",
        port: 2222,
        sshOptions: [{ key: "ServerAliveInterval", value: "30" }],
      },
    });
  });

  it("username 含 @ 時以最後一個 @ 分隔", () => {
    const result = parseSshCommand("ssh a@b@host.example.com");
    expect(result).toMatchObject({
      ok: true,
      value: { username: "a@b", host: "host.example.com" },
    });
  });

  it("失敗形：非 ssh 開頭／無主機／-p 缺值／port 非法／-o 缺值", () => {
    expect(parseSshCommand("scp user@host").ok).toBe(false);
    expect(parseSshCommand("ssh").ok).toBe(false);
    expect(parseSshCommand("ssh -p").ok).toBe(false);
    expect(parseSshCommand("ssh -p abc host").ok).toBe(false);
    expect(parseSshCommand("ssh -o").ok).toBe(false);
  });
});
