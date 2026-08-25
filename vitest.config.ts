import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/unit/worker/**/*.test.ts"],
    setupFiles: ["./test/unit/worker/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          // 測試專用環境變數（正式環境以 wrangler secret 設定）
          bindings: {
            PANEL_PASSWORD: "test-panel-pass",
            ENCRYPTION_KEY: "test-enc-key",
            BACKEND_SSH_PROBE: "1",
            BACKEND_SSH_PROBE_PASSWORD: "secret-pass",
          },
        },
      },
    },
  },
});
