import { beforeEach, describe, expect, it } from "vitest";
import {
  _keyCacheStats,
  decryptString,
  encryptString,
  resetKeyCache,
} from "../../../src/worker/crypto";

beforeEach(() => resetKeyCache());

describe("金鑰衍生快取", () => {
  it("同一 keyMaterial 的多筆 v3 信封只衍生一次金鑰", async () => {
    const envelopes = [];
    for (let i = 0; i < 24; i += 1) {
      envelopes.push(await encryptString("material-a", `機密資料-${i}`));
    }
    for (const envelope of envelopes) {
      await decryptString("material-a", envelope);
    }
    expect(_keyCacheStats().derived).toBe(1);
  });

  it("同一 keyMaterial 的並行首次使用共用同一個衍生 Promise", async () => {
    await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        encryptString("parallel-material", `value-${index}`),
      ),
    );
    expect(_keyCacheStats().derived).toBe(1);
  });

  it("不同 keyMaterial 各自衍生", async () => {
    await encryptString("material-a", "x");
    await encryptString("material-b", "y");
    expect(_keyCacheStats().derived).toBe(2);
  });

  it("快取有上限：超量後大小不無限成長且功能正常", { timeout: 60_000 }, async () => {
    const envelopes: Array<{ key: string; envelope: string }> = [];
    for (let i = 0; i < 18; i++) {
      const key = `material-${i}`;
      envelopes.push({ key, envelope: await encryptString(key, `v${i}`) });
    }
    expect(_keyCacheStats().size).toBeLessThanOrEqual(16);
    const first = envelopes[0]!;
    const text = await decryptString(first.key, first.envelope);
    expect(text).toBe("v0");
  });

  it("resetKeyCache 清空統計", async () => {
    const envelope = await encryptString("m", "a");
    await decryptString("m", envelope);
    expect(_keyCacheStats().size).toBeGreaterThan(0);
    resetKeyCache();
    expect(_keyCacheStats()).toEqual({ size: 0, derived: 0 });
  });
});
