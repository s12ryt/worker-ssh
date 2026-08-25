// 讓 TypeScript 認得 cloudflare:test 模組（vitest-pool-workers）
declare module "cloudflare:test" {
  // 由 wrangler.jsonc 提供的綁定
  interface ProvidedEnv {
    KV: KVNamespace;
    DB: D1Database;
    SSH_SESSIONS: DurableObjectNamespace;
    SSH_QUOTA: DurableObjectNamespace;
    ASSETS: Fetcher;
    PANEL_PASSWORD?: string;
    ENCRYPTION_KEY?: string;
    BACKEND_SSH_PROBE?: string;
    BACKEND_SSH_PROBE_PASSWORD?: string;
  }
  export const env: ProvidedEnv;
  /** 對被測 Worker 發起請求（走 wrangler 設定的 main 入口） */
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}
