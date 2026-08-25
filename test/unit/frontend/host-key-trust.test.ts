import { describe, expect, it, vi } from "vitest";
import type { ConnectionView } from "@/shared/types";
import {
  HostKeyMismatchError,
  HostKeyRejectedError,
  resetHostKeyTrust,
  verifyHostKeyTrust,
} from "@/frontend/host-key-trust";

const INFO = {
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:trusted-fingerprint",
};

function connection(
  patch: Partial<ConnectionView> = {},
): ConnectionView {
  return {
    id: "conn-1",
    folderId: null,
    name: "測試主機",
    host: "example.com",
    port: 22,
    username: "tester",
    authType: "password",
    credentialState: "ready",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("SSH host key TOFU", () => {
  it("已保存且一致時直接接受，不提示也不寫入", async () => {
    const cfg = connection({
      hostKeyType: INFO.keyType,
      hostKeyFingerprint: INFO.fingerprint,
    });
    const confirm = vi.fn();
    const update = vi.fn();

    await expect(
      verifyHostKeyTrust(cfg, INFO, { confirm, update }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("已保存但不一致時阻擋且不覆寫", async () => {
    const cfg = connection({
      hostKeyType: "ssh-rsa",
      hostKeyFingerprint: "SHA256:old-fingerprint",
    });
    const confirm = vi.fn();
    const update = vi.fn();

    await expect(
      verifyHostKeyTrust(cfg, INFO, { confirm, update }),
    ).rejects.toBeInstanceOf(HostKeyMismatchError);
    expect(confirm).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(cfg.hostKeyFingerprint).toBe("SHA256:old-fingerprint");
  });

  it("首次連線取消確認時拒絕且不保存", async () => {
    const cfg = connection();
    const confirm = vi.fn().mockResolvedValue(false);
    const update = vi.fn();

    await expect(
      verifyHostKeyTrust(cfg, INFO, { confirm, update }),
    ).rejects.toBeInstanceOf(HostKeyRejectedError);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(INFO.fingerprint),
      }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(cfg.hostKeyFingerprint).toBeUndefined();
  });

  it("首次確認後保存類型與 SHA-256 指紋並更新本地設定", async () => {
    const cfg = connection();
    const confirm = vi.fn().mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue({
      ...cfg,
      hostKeyType: INFO.keyType,
      hostKeyFingerprint: INFO.fingerprint,
      updatedAt: 2,
    });

    await expect(
      verifyHostKeyTrust(cfg, INFO, { confirm, update }),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(cfg.id, {
      hostKeyType: INFO.keyType,
      hostKeyFingerprint: INFO.fingerprint,
    });
    expect(cfg.hostKeyType).toBe(INFO.keyType);
    expect(cfg.hostKeyFingerprint).toBe(INFO.fingerprint);
  });

  it("確認重設後只清除已信任指紋欄位", async () => {
    const cfg = connection({
      hostKeyType: INFO.keyType,
      hostKeyFingerprint: INFO.fingerprint,
    });
    const confirm = vi.fn().mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue({
      ...cfg,
      hostKeyType: undefined,
      hostKeyFingerprint: undefined,
    });

    await expect(
      resetHostKeyTrust(cfg, { confirm, update }),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(cfg.id, {
      hostKeyType: null,
      hostKeyFingerprint: null,
    });
    expect(cfg.name).toBe("測試主機");
    expect(cfg.hostKeyType).toBeUndefined();
    expect(cfg.hostKeyFingerprint).toBeUndefined();
  });
});
