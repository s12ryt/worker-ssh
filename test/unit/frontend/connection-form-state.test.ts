import { describe, expect, it } from "vitest";
import type { ConnectionView } from "../../../src/shared/types";
import {
  assertConnectionReady,
  buildConnectionSubmission,
  connectionFormValues,
} from "../../../src/frontend/connection-form-state";

const CONNECTION: ConnectionView = {
  id: "conn-1",
  folderId: null,
  name: "Fixture",
  host: "example.com",
  port: 22,
  username: "tester",
  authType: "password",
  credentialState: "ready",
  createdAt: 1,
  updatedAt: 1,
};

describe("connection form state", () => {
  it("編輯既有連線時三個憑證欄位永遠保持空白", () => {
    expect(connectionFormValues(CONNECTION)).toMatchObject({
      password: "",
      privateKey: "",
      passphrase: "",
    });
  });

  it("編輯時空白密碼代表保留，提交內容不包含任何憑證欄位", () => {
    const submission = buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      name: "Renamed",
    });

    expect(submission).toMatchObject({ name: "Renamed", authType: "password" });
    expect(submission).not.toHaveProperty("password");
    expect(submission).not.toHaveProperty("privateKey");
    expect(submission).not.toHaveProperty("passphrase");
  });

  it("新增或切換認證方式時必須提供對應憑證", () => {
    expect(() => buildConnectionSubmission(undefined, {
      name: "New",
      host: "example.com",
      port: "22",
      username: "tester",
      authType: "password",
      password: "",
      privateKey: "",
      passphrase: "",
    })).toThrow("請輸入 SSH 密碼");

    expect(() => buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      authType: "privateKey",
    })).toThrow("請輸入 SSH 私鑰");
  });

  it("credential missing 時禁止連線並給出可操作錯誤", () => {
    expect(() => assertConnectionReady({
      ...CONNECTION,
      credentialState: "missing",
    })).toThrow("請先編輯連線並設定憑證");
  });
});
