import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  parseSessionCookie,
  verifyPanelPassword,
  verifySessionToken,
} from "../../../src/worker/auth";

const PASSWORD = "panel-pass-密碼";

describe("verifyPanelPassword", () => {
  it("正確密碼回傳 true", async () => {
    await expect(verifyPanelPassword(PASSWORD, PASSWORD)).resolves.toBe(true);
  });
  it("錯誤密碼回傳 false", async () => {
    await expect(verifyPanelPassword("wrong", PASSWORD)).resolves.toBe(false);
  });
  it("空字串回傳 false", async () => {
    await expect(verifyPanelPassword("", PASSWORD)).resolves.toBe(false);
  });
});

describe("session token", () => {
  it("建立後可驗證成功並附效期", async () => {
    const { token, expiresAt } = await createSessionToken(PASSWORD, 60_000);
    expect(expiresAt).toBeGreaterThan(Date.now());
    await expect(verifySessionToken(token, PASSWORD)).resolves.toBe(true);
  });

  it("以不同密碼建立的 token 無法互通", async () => {
    const { token } = await createSessionToken("other-password", 60_000);
    await expect(verifySessionToken(token, PASSWORD)).resolves.toBe(false);
  });

  it("竄改 token 內容應失敗", async () => {
    const { token } = await createSessionToken(PASSWORD, 60_000);
    const [payload, sig] = token.split(".");
    const forgedPayload = btoa(JSON.stringify({ exp: Date.now() + 999_999_999 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expect(verifySessionToken(`${forgedPayload}.${sig}`, PASSWORD)).resolves.toBe(false);
    await expect(verifySessionToken(`${payload}.${sig}x`, PASSWORD)).resolves.toBe(false);
  });

  it("過期 token 應失敗", async () => {
    const { token } = await createSessionToken(PASSWORD, -1); // 已過期
    await expect(verifySessionToken(token, PASSWORD)).resolves.toBe(false);
  });

  it("格式非法的 token 應失敗而非拋出非預期錯誤", async () => {
    await expect(verifySessionToken("", PASSWORD)).resolves.toBe(false);
    await expect(verifySessionToken("garbage", PASSWORD)).resolves.toBe(false);
    await expect(verifySessionToken("a.b.c", PASSWORD)).resolves.toBe(false);
  });
});

describe("parseSessionCookie", () => {
  it("可從 Cookie header 取出 session 值", () => {
    expect(parseSessionCookie("a=b; worker_ssh_session=tok123; c=d")).toBe("tok123");
  });
  it("無 cookie 或無對應鍵時回傳 null", () => {
    expect(parseSessionCookie(null)).toBeNull();
    expect(parseSessionCookie("other=x")).toBeNull();
  });
});
