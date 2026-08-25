import { describe, expect, it } from "vitest";
import {
  decryptString,
  decryptStringDetailed,
  encryptString,
} from "../../../src/worker/crypto";
import { encryptLegacyV1 } from "./crypto-fixtures";

const KEY = "test-encryption-key-材料";
const KEY2 = "another-key";

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

describe("encryptString / decryptString", () => {
  it("明文加密後可解密還原（含中文與特殊字元）", async () => {
    const plaintext = JSON.stringify({ msg: "機密資料🔐 <>&\"'" });
    const envelope = await encryptString(KEY, plaintext);
    expect(envelope.startsWith("v2:")).toBe(true);
    expect(envelope).not.toContain(plaintext);
    await expect(decryptString(KEY, envelope)).resolves.toBe(plaintext);
    await expect(decryptStringDetailed(KEY, envelope)).resolves.toEqual({
      plaintext,
      version: "v2",
    });
  });

  it("空字串可加解密", async () => {
    const envelope = await encryptString(KEY, "");
    await expect(decryptString(KEY, envelope)).resolves.toBe("");
  });

  it("相同明文兩次加密產生不同 v2 信封（獨立隨機 IV）", async () => {
    const a = await encryptString(KEY, "same");
    const b = await encryptString(KEY, "same");
    expect(a).not.toBe(b);
    await expect(decryptString(KEY, a)).resolves.toBe("same");
    await expect(decryptString(KEY, b)).resolves.toBe("same");
  });

  it("錯誤金鑰解密應失敗", async () => {
    const envelope = await encryptString(KEY, "secret");
    await expect(decryptString(KEY2, envelope)).rejects.toThrow();
  });

  it("密文遭竄改應失敗", async () => {
    const envelope = await encryptString(KEY, "secret");
    const bytes = Uint8Array.from(atob(envelope.slice(3)), (c) => c.charCodeAt(0));
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0x01; // 翻轉最後一個位元
    const tampered = `v2:${toBase64(bytes)}`;
    await expect(decryptString(KEY, tampered)).rejects.toThrow();
  });

  it("格式錯誤的信封應失敗而非拋出非預期錯誤", async () => {
    await expect(decryptString(KEY, "not-base64!!!")).rejects.toThrow();
    await expect(decryptString(KEY, btoa("short"))).rejects.toThrow();
    await expect(decryptString(KEY, "v2:not-base64!!!")).rejects.toThrow();
    await expect(decryptString(KEY, `v2:${btoa("short")}`)).rejects.toThrow();
  });

  it("v2 信封結構為前綴加 iv(12)+密文，且不再攜帶逐筆 salt", async () => {
    const envelope = await encryptString(KEY, "abc");
    expect(envelope.startsWith("v2:")).toBe(true);
    const bytes = Uint8Array.from(atob(envelope.slice(3)), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(12 + 3 + 16);
  });

  it("可讀取無版本前綴的既有 v1 信封並辨識版本", async () => {
    const plaintext = JSON.stringify({ legacy: true, text: "舊資料" });
    const envelope = await encryptLegacyV1(KEY, plaintext);

    expect(envelope.startsWith("v2:")).toBe(false);
    await expect(decryptString(KEY, envelope)).resolves.toBe(plaintext);
    await expect(decryptStringDetailed(KEY, envelope)).resolves.toEqual({
      plaintext,
      version: "v1",
    });
  });
});
