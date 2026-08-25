# worker-ssh

以 Cloudflare Workers、Durable Objects、D1 與 Go WebAssembly 建構的瀏覽器 SSH 管理工具。它提供加密連線設定、巢狀資料夾、終端、SFTP、主機監控、TOFU 主機指紋確認與自動重連。

## 功能

- 純 Worker 後端 SSH：瀏覽器不會取得已儲存的密碼或私鑰。
- D1 加密主儲存：連線 payload 與資料夾名稱以 AES-GCM 保存。
- 巢狀資料夾、批量移動、拖放與遞迴主機數。
- SSH 終端、SFTP 串流讀寫、Linux/macOS/BSD 主機監控。
- TOFU 主機指紋、連線配額、RPC frame／速率／並行限制。
- 深色與高對比主題、終端字級、監控頻率及重連偏好。

## 一鍵部署到 Cloudflare

Repository 內建 GitHub Actions workflow **Deploy to Cloudflare**。它只支援手動 `workflow_dispatch`，不會因 push、pull request 或 tag 自動部署。

### 1. 建立 Cloudflare API Token

Token 建議限制到單一 Cloudflare account，並只授予：

- Workers Scripts: **Edit**
- D1: **Edit**
- Workers KV Storage: **Edit**

### 2. 設定 GitHub repository secrets

到 GitHub repository 的 **Settings > Secrets and variables > Actions**，新增：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 查找／建立資源及部署 Worker |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `PANEL_PASSWORD` | 網頁面板登入密碼 |
| `ENCRYPTION_KEY` | D1 連線資料加密金鑰；部署後請勿任意更換 |

不要把 `.dev.vars`、Cloudflare token 或正式密碼提交到 repository。

### 3. 執行手動 workflow

1. 開啟 GitHub repository 的 **Actions**。
2. 選擇 **Deploy to Cloudflare**。
3. 點擊 **Run workflow**。

Workflow 會依序執行：

1. 安裝 Node.js／Go 相依套件。
2. 執行完整測試、型別檢查、建置與拆包檢查。
3. 查找 `worker-ssh-db` D1 與 `worker-ssh-kv` KV；存在則重用，不存在才建立。
4. 產生不入版控的一次性 Wrangler config 與 secret JSON。
5. 執行 Wrangler dry-run，再部署 `worker-ssh`。
6. 無論成功或失敗都刪除暫存部署檔案。

首次登入正式環境後，應用程式會透過既有 bootstrap 流程建立 D1 schema。部署 workflow **不會搬移或上傳本機 D1、KV、SSH 連線或測試資料**。

## 本機開發

需求：Node.js 22、Go 1.26、npm。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev -- --port 8787 --env-file .dev.vars
```

Windows PowerShell 可用 `Copy-Item .dev.vars.example .dev.vars` 取代 `cp`。

常用驗證：

```bash
npm test
npm run typecheck
npm run build
npm run check:split
```

## 安全邊界

- 一般 API 不回傳已儲存的 `password`、`privateKey` 或 `passphrase`。
- SSH credential 只在 Worker／Durable Object 記憶體中短暫使用。
- 新連線採 TOFU SHA-256 主機指紋確認；不一致時拒絕連線。
- 部署暫存設定與 secret 檔位於 `.cloudflare-deploy/`，已由 `.gitignore` 排除並由 workflow 無條件清理。

## License

[MIT](LICENSE)
