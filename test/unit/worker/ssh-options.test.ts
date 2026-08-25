import { describe, expect, it } from "vitest";
import {
  SSH_OPTION_KEYS,
  parseAccessProxyCommand,
  validateAccessProxy,
  validateAccessProxyShape,
  validateSshOption,
  validateSshOptions,
} from "../../../src/shared/ssh-options";

/**
 * SSH -o 選項白名單契約（第二十三節）：
 * - 僅接受可映射到 x/crypto/ssh 或轉為 Access 代理的選項
 * - 鍵大小寫不敏感，正規化為 canonical PascalCase
 * - 白名單外選項儲存時拒絕並列出選項名
 * - ProxyCommand 僅接受 cloudflared access ssh 形態
 */

describe("SSH_OPTION_KEYS 白名單", () => {
  it("只包含支援的選項鍵", () => {
    expect([...SSH_OPTION_KEYS].sort()).toEqual([
      "Ciphers",
      "ConnectTimeout",
      "HostKeyAlgorithms",
      "KexAlgorithms",
      "MACs",
      "ProxyCommand",
      "ServerAliveCountMax",
      "ServerAliveInterval",
    ]);
  });
});

describe("validateSshOption 純量選項", () => {
  it("鍵大小寫不敏感並正規化為 canonical", () => {
    const result = validateSshOption("serveraliveinterval", "60");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.option.key).toBe("ServerAliveInterval");
  });

  it("ServerAliveInterval 允許 0–600；逾界或非整數拒絕", () => {
    expect(validateSshOption("ServerAliveInterval", "0").ok).toBe(true);
    expect(validateSshOption("ServerAliveInterval", "600").ok).toBe(true);
    expect(validateSshOption("ServerAliveInterval", "601").ok).toBe(false);
    expect(validateSshOption("ServerAliveInterval", "-1").ok).toBe(false);
    expect(validateSshOption("ServerAliveInterval", "abc").ok).toBe(false);
  });

  it("ServerAliveCountMax 允許 1–100", () => {
    expect(validateSshOption("ServerAliveCountMax", "1").ok).toBe(true);
    expect(validateSshOption("ServerAliveCountMax", "100").ok).toBe(true);
    expect(validateSshOption("ServerAliveCountMax", "0").ok).toBe(false);
    expect(validateSshOption("ServerAliveCountMax", "101").ok).toBe(false);
  });

  it("ConnectTimeout 允許 1–120 秒", () => {
    expect(validateSshOption("ConnectTimeout", "1").ok).toBe(true);
    expect(validateSshOption("ConnectTimeout", "120").ok).toBe(true);
    expect(validateSshOption("ConnectTimeout", "0").ok).toBe(false);
    expect(validateSshOption("ConnectTimeout", "121").ok).toBe(false);
  });

  it("演算法清單：非空逗號 token、合法字元集；空值/空 token/非法字元拒絕", () => {
    expect(validateSshOption("Ciphers", "aes128-ctr,aes256-gcm@openssh.com").ok).toBe(true);
    expect(validateSshOption("MACs", "hmac-sha2-256").ok).toBe(true);
    expect(validateSshOption("KexAlgorithms", "curve25519-sha256").ok).toBe(true);
    expect(validateSshOption("HostKeyAlgorithms", "ssh-ed25519").ok).toBe(true);
    expect(validateSshOption("Ciphers", "").ok).toBe(false);
    expect(validateSshOption("Ciphers", "a,,b").ok).toBe(false);
    expect(validateSshOption("MACs", "has space").ok).toBe(false);
    expect(validateSshOption("Ciphers", "bad;char").ok).toBe(false);
  });

  it("值會 trim 且移除成對包覆引號", () => {
    const result = validateSshOption("Ciphers", '  "aes128-ctr"  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.option.value).toBe("aes128-ctr");
  });

  it("未知選項鍵拒絕並回報鍵名；ProxyCommand 不是純量選項", () => {
    const unknown = validateSshOption("StrictHostKeyChecking", "no");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.key).toBe("StrictHostKeyChecking");

    expect(validateSshOption("ProxyCommand", "cloudflared access ssh").ok).toBe(false);
  });
});

describe("parseAccessProxyCommand cloudflared 形態", () => {
  it("基本形態：cloudflared access ssh --hostname <H>", () => {
    const result = parseAccessProxyCommand(
      "cloudflared access ssh --hostname loc-ssh.czy-cf.eu.cc",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proxy.hostname).toBe("loc-ssh.czy-cf.eu.cc");
      expect(result.proxy.destination).toBeUndefined();
    }
  });

  it("支援 --destination（bastion）與完整執行檔路徑與引號", () => {
    const result = parseAccessProxyCommand(
      '"/usr/local/bin/cloudflared" access ssh --hostname "tunnel.example.com" --destination 10.0.0.5:22',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proxy.hostname).toBe("tunnel.example.com");
      expect(result.proxy.destination).toBe("10.0.0.5:22");
    }
  });

  it("旗標順序可調換；--service-token-id/--service-token-secret 屬命令列旗標可容忍", () => {
    const result = parseAccessProxyCommand(
      "cloudflared access ssh --destination h2.internal:22 --hostname edge.example.com",
    );
    expect(result.ok).toBe(true);
  });

  it("非 cloudflared 命令、未知旗標、缺少 --hostname、空主機皆拒絕", () => {
    expect(parseAccessProxyCommand("nc %h %p").ok).toBe(false);
    expect(
      parseAccessProxyCommand("cloudflared access ssh --proxy dns://1.1.1.1 --hostname h.example.com").ok,
    ).toBe(false);
    expect(parseAccessProxyCommand("cloudflared access ssh").ok).toBe(false);
    expect(parseAccessProxyCommand("cloudflared access ssh --hostname ").ok).toBe(false);
    expect(parseAccessProxyCommand("cloudflared tunnel run").ok).toBe(false);
  });
});

describe("validateSshOptions 彙總", () => {
  it("全部合法時回傳正規化後的選項陣列（保留輸入順序）", () => {
    const result = validateSshOptions([
      { key: "ServerAliveInterval", value: "60" },
      { key: "ciphers", value: "aes128-ctr" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options).toEqual([
        { key: "ServerAliveInterval", value: "60" },
        { key: "Ciphers", value: "aes128-ctr" },
      ]);
    }
  });

  it("混合未知選項時拒絕並列出全部不支援鍵名", () => {
    const result = validateSshOptions([
      { key: "ServerAliveInterval", value: "60" },
      { key: "StrictHostKeyChecking", value: "no" },
      { key: "Compression", value: "yes" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unsupported).toEqual([
        "StrictHostKeyChecking",
        "Compression",
      ]);
    }
  });

  it("數值選項非法時拒絕並指明鍵與原因", () => {
    const result = validateSshOptions([
      { key: "ConnectTimeout", value: "999" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unsupported).toBeUndefined();
  });
});

describe("validateAccessProxy", () => {
  it("最小合法：僅 hostname（無 Access 政策的公開 tunnel）", () => {
    const result = validateAccessProxy({ hostname: "tunnel.example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proxy).toEqual({ hostname: "tunnel.example.com" });
    }
  });

  it("clientId 存在時 clientSecret 必填；完整欄位可通過", () => {
    expect(
      validateAccessProxy({ hostname: "h.example.com", clientId: "cid" }).ok,
    ).toBe(false);
    expect(
      validateAccessProxy({
        hostname: "h.example.com",
        clientId: "cid",
        clientSecret: "secret",
        destination: "10.0.0.5:22",
      }).ok,
    ).toBe(true);
  });

  it("hostname 必填且字元受限；clientId 不得為空字串", () => {
    expect(validateAccessProxy({}).ok).toBe(false);
    expect(validateAccessProxy({ hostname: "bad host" }).ok).toBe(false);
    expect(
      validateAccessProxy({ hostname: "h.example.com", clientId: "" }).ok,
    ).toBe(false);
  });
});

describe("validateAccessProxyShape（PUT 寬鬆驗證：secret 可沿用）", () => {
  it("接受無 clientSecret 的 clientId（secret 由 store 合併既有值）", () => {
    const result = validateAccessProxyShape({
      hostname: "h.example.com",
      clientId: "cid",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proxy).toEqual({ hostname: "h.example.com", clientId: "cid" });
    }
  });

  it("clientSecret 明確提供時不得為空字串；格式檢查與嚴格版一致", () => {
    expect(
      validateAccessProxyShape({ hostname: "h", clientSecret: "" }).ok,
    ).toBe(false);
    expect(validateAccessProxyShape({ hostname: "bad host" }).ok).toBe(false);
    expect(validateAccessProxyShape({}).ok).toBe(false);
    expect(
      validateAccessProxyShape({
        hostname: "h.example.com",
        clientId: "cid",
        clientSecret: "s",
        destination: "10.0.0.5:22",
      }).ok,
    ).toBe(true);
  });
});
