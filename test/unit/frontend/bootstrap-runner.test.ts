import { describe, expect, it, vi } from "vitest";
import type { BootstrapStatusView } from "../../../src/shared/types";
import {
  BootstrapFailedError,
  runBootstrap,
} from "../../../src/frontend/bootstrap-runner";

const status = (
  patch: Partial<BootstrapStatusView>,
): BootstrapStatusView => ({
  status: "pending",
  phase: "kv_scan",
  schemaVersion: 1,
  percent: 0,
  processed: 0,
  total: 0,
  ...patch,
});

describe("runBootstrap", () => {
  it("已完成時不執行額外步驟", async () => {
    const getStatus = vi.fn().mockResolvedValue(status({
      status: "complete",
      phase: "complete",
      percent: 100,
    }));
    const step = vi.fn();

    await expect(runBootstrap({ getStatus, step })).resolves.toMatchObject({
      status: "complete",
    });
    expect(step).not.toHaveBeenCalled();
  });

  it("逐步回報持久進度直到完成", async () => {
    const updates: BootstrapStatusView[] = [];
    const getStatus = vi.fn().mockResolvedValue(status({ total: 10 }));
    const step = vi.fn()
      .mockResolvedValueOnce(status({ status: "running", phase: "kv_migrate", processed: 4, total: 10, percent: 40 }))
      .mockResolvedValueOnce(status({ status: "running", phase: "verify", processed: 10, total: 10, percent: 85 }))
      .mockResolvedValueOnce(status({ status: "complete", phase: "complete", processed: 10, total: 10, percent: 100 }));

    await runBootstrap({
      getStatus,
      step,
      onStatus: (value) => updates.push(value),
      delay: async () => undefined,
    });

    expect(step).toHaveBeenCalledTimes(3);
    expect(updates.map((value) => value.percent)).toEqual([0, 40, 85, 100]);
  });

  it("失敗狀態停止循環並保留安全錯誤代碼供重試 UI 顯示", async () => {
    const failed = status({
      status: "failed",
      phase: "kv_migrate",
      errorCode: "KV_CONNECTION_INVALID",
    });

    await expect(runBootstrap({
      getStatus: vi.fn().mockResolvedValue(failed),
      step: vi.fn(),
    })).rejects.toEqual(new BootstrapFailedError(failed));
  });
});
