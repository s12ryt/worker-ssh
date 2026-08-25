# worker-ssh

以 Cloudflare Workers、Durable Objects、D1 與 Go WebAssembly 建構的瀏覽器 SSH 管理工具。它提供加密連線設定、巢狀資料夾、終端、SFTP、主機監控、TOFU 主機指紋確認與自動重連。

## 功能

- 純 Worker 後端 SSH：瀏覽器不會取得已儲存的密碼或私鑰。
- D1 加密主儲存：連線 payload 與資料夾名稱以 AES-GCM 保存。
- 巢狀資料夾、批量移動、拖放與遞迴主機數。
- SSH 終端、SFTP 串流讀寫、Linux/macOS/BSD 主機監控。
- TOFU 主機指紋、連線配額、RPC frame／速率／並行限制。
- IPv6 主機位址：裸 IPv6（`2001:db8::1`）與帶方括號（`[2001:db8::1]`）皆可輸入，連線時自動正規化。
- SSH 附加選項（`ssh -o`）：表單逐行設定或貼上整串 ssh 指令自動匯入（見下方說明）。
- Cloudflare Access SSH 代理：免安裝 cloudflared，直接以 WebSocket 通道連接受 Access 保護的主機（見下方說明）。
- 深色與高對比主題、終端字級、監控頻率及重連偏好。

## SSH 主機位址與 IPv6

主機欄位接受域名、IPv4 與 IPv6。IPv6 可用裸位址或方括號形式：

```text
2001:db8::1
[2001:db8::1]
```

連線時會修剪空白，並將 IPv6 字面位址正規化為單層方括號形式（Cloudflare Workers TCP sockets 的要求）；兩種寫法視為同一主機。儲存時保持原樣輸入。

## SSH 附加選項（-o）

連線表單的「SSH 選項」以逐行 `Key=Value` 填寫，等同 `ssh -o Key=Value`。支援的選項白名單：

| 選項 | 說明 |
| --- | --- |
| `ServerAliveInterval` | keepalive 秒數（0–600，>0 時自動啟用 keepalive） |
| `ServerAliveCountMax` | keepalive 連續失敗上限（1–100，預設 3） |
| `ConnectTimeout` | TCP 交握逾時秒數（1–120） |
| `Ciphers` | 加密演算法清單（逗號分隔） |
| `MACs` | MAC 演算法清單 |
| `KexAlgorithms` | 金鑰交換演算法清單 |
| `HostKeyAlgorithms` | 主機金鑰演算法清單 |
| `ProxyCommand` | 僅支援 `cloudflared access ssh --hostname ...` 形態，自動轉換為 Access 代理設定 |

白名單以外的選項（如 `StrictHostKeyChecking`，與內建 TOFU 主機指紋確認衝突）會在儲存時被拒絕並列出選項名。

### 由 ssh 指令匯入

表單頂部可貼上整串 ssh 指令自動填入，例如：

```bash
ssh -o ServerAliveInterval=30 -o ProxyCommand="cloudflared access ssh --hostname ssh.example.com" user@203.0.113.10 -p 2222
```

解析器會帶入主機、埠、使用者名稱與 `-o` 選項；`ProxyCommand` 為 cloudflared Access 形態時自動轉換為 Access 代理設定。不支援的旗標與選項會以提示列出但不影響匯入。

## Cloudflare Access SSH 代理

針對由 Cloudflare Zero Trust（Access + Tunnel）保護的 SSH 主機，worker-ssh 內建 Access WebSocket 通道，**不需要在瀏覽器或本機安裝 cloudflared**：

1. 主機經 `cloudflared tunnel` 發佈，並在 Zero Trust 後台為該 hostname 建立 Access 應用程式。
2. 如需服務Token驗證，到 Zero Trust 後台 **Settings > Service Tokens** 建立 token，將 Client ID / Client Secret 填入連線表單的 Access 區塊。Public（無驗證政策）的 tunnel 可留空。
3. 也可以直接在表單填 `ProxyCommand=cloudflared access ssh --hostname <hostname>`，系統會自動轉換。
4. 使用 self-hosted cloudflared（SSH 模式，非 tunnel）時，額外填寫 Jump Destination（`host[:port]`），等同 `Cf-Access-Jump-Destination`。

通道以 WebSocket binary frame 承載原始 SSH TCP bytes，認證 headers 為 `CF-Access-Client-Id` / `CF-Access-Client-Secret`（service token）。Client Secret 加密儲存於 D1，API 回應永不回傳。

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
| `ENCRYPTION_KEY` | D1 連線資料加密根金鑰；請使用密碼管理器或密碼學安全亂數產生的高熵隨機值，部署後請勿任意更換 |

不要把 `.dev.vars`、Cloudflare token 或正式密碼提交到 repository。
`ENCRYPTION_KEY` 不建議使用人類可讀長句、常見密碼或規律字串；目前加密信封以 HKDF-SHA256 從高熵根金鑰衍生 AES-256-GCM key。

### 3. 執行手動 workflow

1. 開啟 GitHub repository 的 **Actions**。
2. 選擇 **Deploy to Cloudflare**。
3. 點擊 **Run workflow**。

Workflow 會依序執行：

1. 安裝 Node.js／Go 相依套件。
2. 執行型別檢查，建立 Go WASM／Worker／前端產物並完成拆包檢查，再執行完整測試。
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
