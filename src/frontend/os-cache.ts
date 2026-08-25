// OS 資訊的客戶端工作階段快取：
// 消除連線列表重繪與偵測流程對同一 key 的重複 /api/os 請求（每次皆為一次 KV 讀）。
import type { OsInfo } from "@/shared/types";

export class OsCache {
  private readonly mem = new Map<string, OsInfo>();
  /** 進行中的載入 Promise：並發 fetch 同一 key 時去重 */
  private readonly inflight = new Map<string, Promise<OsInfo | null>>();

  /**
   * 取得指定 key 的 OS 資訊；記憶體 miss 時呼叫 loader（通常為 api.getOs）。
   * loader 回 null（KV 未命中）或拋錯時不寫入快取，下次仍會重試。
   */
  fetch(key: string, loader: (key: string) => Promise<OsInfo | null>): Promise<OsInfo | null> {
    const hit = this.mem.get(key);
    if (hit) return Promise.resolve(hit);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = loader(key)
      .then((info) => {
        if (info) this.mem.set(key, info);
        return info;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  /** 直接寫入快取（偵測成功並 putOs 後立即生效，省一次回讀） */
  put(key: string, info: OsInfo): void {
    this.mem.set(key, info);
  }
}
