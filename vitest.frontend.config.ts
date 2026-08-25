import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 相對路徑跨目錄解析在本機環境不穩定，統一以 @ 指向 src/
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["test/unit/frontend/**/*.test.ts"],
    environment: "node",
  },
});
