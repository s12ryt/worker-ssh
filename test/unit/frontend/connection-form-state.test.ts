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
      sshOptionsText: "",
      accessHostname: "",
      accessDestination: "",
      accessClientId: "",
      accessClientSecret: "",
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

describe("SSH 選項與 Access 代理表單欄位", () => {
  const WITH_OPTIONS: ConnectionView = {
    ...CONNECTION,
    sshOptions: [
      { key: "ServerAliveInterval", value: "60" },
      { key: "Ciphers", value: "aes128-gcm@openssh.com" },
    ],
    accessProxy: { hostname: "loc-ssh.example.com", destination: "10.0.0.1:22", clientId: "cid-1" },
  };

  it("connectionFormValues：sshOptions 逐行 Key=Value、accessProxy 填欄位且 secret 不重現", () => {
    const values = connectionFormValues(WITH_OPTIONS);
    expect(values.sshOptionsText).toBe(
      "ServerAliveInterval=60\nCiphers=aes128-gcm@openssh.com",
    );
    expect(values.accessHostname).toBe("loc-ssh.example.com");
    expect(values.accessDestination).toBe("10.0.0.1:22");
    expect(values.accessClientId).toBe("cid-1");
    expect(values.accessClientSecret).toBe("");
  });

  it("提交時逐行解析 sshOptions；空白行略過", () => {
    const submission = buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      sshOptionsText: "\n  ServerAliveInterval=60 \n\nConnectTimeout=10\n",
    });
    expect(submission.sshOptions).toEqual([
      { key: "ServerAliveInterval", value: "60" },
      { key: "ConnectTimeout", value: "10" },
    ]);
  });

  it("sshOptions 全空：編輯時送 null 清除；新建時不附欄位", () => {
    const editing = buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      sshOptionsText: "  \n",
    });
    expect(editing.sshOptions).toBeNull();

    const creating = buildConnectionSubmission(undefined, {
      name: "New",
      host: "example.com",
      port: "22",
      username: "tester",
      authType: "password",
      password: "pw",
      privateKey: "",
      passphrase: "",
      sshOptionsText: "",
      accessHostname: "",
      accessDestination: "",
      accessClientId: "",
      accessClientSecret: "",
    });
    expect(creating).not.toHaveProperty("sshOptions");
  });

  it("非法選項行：未知鍵或缺 = 時 throw 含行號", () => {
    expect(() => buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      sshOptionsText: "ServerAliveInterval=60\nStrictHostKeyChecking=no",
    })).toThrow("第 2 行");

    expect(() => buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      sshOptionsText: "no-equal-sign",
    })).toThrow("第 1 行");
  });

  it("accessHostname 有效且欄位齊全 → 提交 accessProxy；編輯時 secret 空白表沿用（不附欄位）", () => {
    const editing = buildConnectionSubmission(WITH_OPTIONS, {
      ...connectionFormValues(WITH_OPTIONS),
      accessHostname: "new-loc.example.com",
      accessDestination: "",
      accessClientId: "cid-2",
      accessClientSecret: "",
    });
    expect(editing.accessProxy).toEqual({ hostname: "new-loc.example.com", clientId: "cid-2" });

    const creating = buildConnectionSubmission(undefined, {
      name: "New",
      host: "example.com",
      port: "22",
      username: "tester",
      authType: "password",
      password: "pw",
      privateKey: "",
      passphrase: "",
      sshOptionsText: "",
      accessHostname: "loc.example.com",
      accessDestination: "10.0.0.1:22",
      accessClientId: "cid",
      accessClientSecret: "sec",
    });
    expect(creating.accessProxy).toEqual({
      hostname: "loc.example.com",
      destination: "10.0.0.1:22",
      clientId: "cid",
      clientSecret: "sec",
    });
  });

  it("accessHostname 清空：編輯且原有代理 → null 清除；新建 → 不附欄位", () => {
    const editing = buildConnectionSubmission(WITH_OPTIONS, {
      ...connectionFormValues(WITH_OPTIONS),
      accessHostname: " ",
    });
    expect(editing.accessProxy).toBeNull();

    const creating = buildConnectionSubmission(undefined, {
      name: "New",
      host: "example.com",
      port: "22",
      username: "tester",
      authType: "password",
      password: "pw",
      privateKey: "",
      passphrase: "",
      sshOptionsText: "",
      accessHostname: "",
      accessDestination: "",
      accessClientId: "",
      accessClientSecret: "",
    });
    expect(creating).not.toHaveProperty("accessProxy");
  });

  it("新建時 clientId 有而 secret 空 → 前端提前拒絕；hostname 非法 → throw", () => {
    expect(() => buildConnectionSubmission(undefined, {
      name: "New",
      host: "example.com",
      port: "22",
      username: "tester",
      authType: "password",
      password: "pw",
      privateKey: "",
      passphrase: "",
      sshOptionsText: "",
      accessHostname: "loc.example.com",
      accessDestination: "",
      accessClientId: "cid",
      accessClientSecret: "",
    })).toThrow("clientSecret");

    expect(() => buildConnectionSubmission(CONNECTION, {
      ...connectionFormValues(CONNECTION),
      accessHostname: "bad host!",
    })).toThrow("hostname");
  });
});
