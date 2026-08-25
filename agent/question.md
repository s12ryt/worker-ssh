# 已確認需求與決策紀錄（question.md）

> 本文件為實作與驗收的唯一依據。需求異動時必須同步更新。
> 確認日期：2026-08-22

## 一、原始需求（todos.md）

1. 專案用途：透過 Cloudflare Worker 提供 SSH 連線與雲保存
2. 即時的主機佔用資訊與 SFTP
3. 支援私鑰登入與密碼登入
4. 自動識別當前連線主機的系統並使用 KV 快取，首頁顯示該系統圖標
5. 使用「Liquid Glass（液態玻璃）」作為網頁主題，基礎色淡藍（可淡藍+淺紫漸層），只做暗色
6. 盡量以單 KV 存儲為主；SSH 連線資訊由 KV 存儲
7. 以上完成後進入「自主疊代升級」模式，焦點放在優化 Worker 佔用

## 二、已確認的技術決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | SSH 架構 | **瀏覽器端 SSH**：Worker 僅做 TCP↔WebSocket 位元組流橋接（cloudflare:sockets `connect()`）；SSH 協議由瀏覽器端 JS 函式庫處理 |
| D2 | 主機佔用資訊 | **SSH 指令輪詢**：透過既有 SSH 連線定期執行指令解析，不在目標主機安裝任何東西 |
| D3 | 雲保存範圍 | **僅連線設定同步**（主機/帳號/金鑰等存 KV）；SFTP 僅即時傳輸，檔案不落 KV |
| D4 | 敏感資料保護 | **AES-GCM 加密後存 KV**；金鑰由 Worker 環境變數 `ENCRYPTION_KEY` 提供，明文不出 Worker |
| D5 | 面板認證 | **需要密碼保護**；面板密碼由 Worker 環境變數 `PANEL_PASSWORD` 提供 |
| D6 | 密語架構 | **兩組分開**，皆由 Worker 變數設置：`PANEL_PASSWORD`（登入面板）、`ENCRYPTION_KEY`（KV 資料加解密） |
| D7 | SFTP 功能 | **完整檔案管理**：瀏覽目錄、上傳、下載、刪除、重新命名、新建資料夾 |
| D8 | 監控指標 | CPU 使用率、記憶體用量、磁碟用量、系統負載、**網路流量速率**；每 **3 秒**更新 |
| D9 | OS 圖示 | **simple-icons 向量路徑**（官方商標形狀、CC0 授權）+ 各發行版品牌色渲染，內嵌打包、無外部 CDN 依賴 |
| D10 | 測試框架 | **Vitest**（Worker 端用 @cloudflare/vitest-pool-workers 或等效隔離測試） |

## 二之一、實作期技術調查結論（2026-08-22）

- 調查證實：**不存在成熟維護中的純 JS 瀏覽器端 SSH 函式庫**（ssh2 打包進瀏覽器已被社群證實不可行；libssh.js 已停止維護、相容性風險高）。
- 業界已驗證的瀏覽器端 SSH 模式為 **Go/WebAssembly 客戶端**（hullarb/ssheasy MIT、c2FmZQ/sshterm），SSH 協議由 golang.org/x/crypto/ssh 在瀏覽器內以 WASM 執行。
- 本機已安裝 Go 1.26.3，可自行編譯 WASM。

| # | 議題 | 決策 |
|---|------|------|
| D11 | SSH 引擎 | **自製 Go/WASM 模組**（golang.org/x/crypto/ssh + github.com/pkg/sftp）於瀏覽器執行；以 `go test` 對 in-process SSH server 做 TDD。Worker 維持純位元組橋接，CPU 佔用趨近於零 |
| D12 | UI 測試深度 | **純邏輯 TDD＋膠水層編譯驗證**：可抽離的純邏輯（monitor 差值計算、格式化等）以 node env Vitest TDD；DOM/WebSocket 膠水層（main/terminal/sftp-panel）以 typecheck＋build＋wrangler dev 整合驗證（同 Go main.go 前例） |
| D13 | BSD 監控 | **Darwin 風格指令＋優雅降級**：BSD 家族使用與 macOS 相容指令集，解析失敗欄位顯示「--」，不影響其他指標 |
| D14 | 疊代目標 | **量測驅動、兩者兼顧**：先量測 bundle 大小／KV 讀寫次數／橋接緩衝策略，再依數據逐項最佳化啟動體積與執行期資源 |

## 三、由決策衍生的實作細節（依折衷原則自行裁定）

- 解密在 **Worker 端**進行：前端登入後經 API 取得解密後的連線資料；寫入時由 Worker 加密後存 KV。`ENCRYPTION_KEY` 永不傳出 Worker。
- Session：登入成功後核發 HMAC 簽名的無狀態 token（附效期），後續 API 以此驗證。
- KV 佈局（單一 namespace）：連線設定清單（加密 JSON）、各主機 OS 偵測快取等，皆以結構化 key 前綴區分。
- 前端為單頁應用，由 Worker 直接服務靜態資源（esbuild 打包，無外部 CDN）。
- UI 語言：繁體中文。

## 四、驗收條件

1. 部署後（wrangler dev 本地即可驗證）未登入者無法存取任何面板 API 與 WebSocket 橋接。
2. 可新增/編輯/刪除 SSH 連線設定（支援密碼或私鑰兩種認證型別），重整後仍存在（KV 持久化），且 KV 中不可見明文密碼/私鑰。
3. 點擊連線可建立 SSH 終端機（xterm.js），可互動執行指令。
4. 連線期間每 3 秒顯示 CPU／記憶體／磁碟／負載／網路流量速率。
5. SFTP 檔案面板可瀏覽、上傳、下載、刪除、改名、新建資料夾。
6. 首次連線自動偵測目標系統並快取至 KV；首頁連線卡片顯示對應 OS 圖示（simple-icons 形狀＋品牌色）。
7. 全站 Liquid Glass 暗色主題：淡藍→淺紫漸層底、玻璃擬態卡片（模糊、透明、高光邊框）。
8. 全部單元/整合測試通過；typecheck、lint、build 無錯誤。

| D15 | 圖示風格 | **實心 filled 風**（Material Icons 類路徑），與既有 simple-icons OS 品牌圖示一致；fill=currentColor 跟隨文字色 |
| D16 | 按鈕呈現 | SFTP 工具列按鈕（上傳／新增資料夾／重新整理）**僅圖示**，以 aria-label＋title 提供無障礙提示 |
| D17 | 符號替換範圍 | 監控卡 ↓下行／↑上行 與返回鈕 ← **一併換成 SVG 箭頭圖示並保留文字**；目標：渲染輸出零表情符號／符號字元（程式註解不在範圍內） |

## 五、自主疊代升級第三輪：Web UI 美化（2026-08-22）

> 觸發：使用者「自主疊代升級,幫我把 web-ui 美化」。繼承 D14 量測驅動與既有 Liquid Glass 暗色主題慣例。

| # | 議題 | 決策 |
|---|------|------|
| D18 | 美化重點（全五項） | (1) 視覺精緻度：動畫過渡、骨架屏、空狀態、hover/focus 微互動、陰影高光層次；(2) 監控儀表板視覺化：CPU/記憶體/磁碟 sparkline 趨勢圖；(3) 連線卡片資訊架構：最近連線時間、連線狀態指示、OS 圖示突出、快捷操作重編；(4) SFTP 表格與終端機外觀：行 hover 高亮、檔案類型圖示分色、終端機邊框/標題列；(5) 響應式與行動體驗：行動佈局、觸控友善按鈕尺寸、小螢幕資訊密度 |
| D19 | 圖表庫 | **chart.js/auto**（~70KB），採**連線後預載**策略（連線成功即動態 import，與 terminal chunk 同為延遲載入）；進入監控分頁零延遲 |
| D20 | 連線時間雲同步 | **動 KV schema**：ConnectionConfig 加 `lastConnectedAt`、`lastDisconnectedAt` 兩個數字時間戳（ms epoch）；連線成功寫 lastConnectedAt、斷線寫 lastDisconnectedAt；既有 KV 資料容錯讀取（undefined 顯示「尚未連線」），不主動回填遷移；前端經 PUT /api/connections/:id 更新 |
| D21 | 字型託管 | **自托管 Inter + Noto Sans TC woff2** 至 dist/client/fonts/，CSS @font-face 宣告；**維持零外部 CDN 慣例**（D9 simple-icons 內嵌打包同精神）；精簡字重（400/600）控制體積 |
| D22 | 動畫與無障礙 | 加動畫與微互動，**實作 prefers-reduced-motion 媒體查詢降級**（骨架屏改靜態、過渡改瞬時） |
| D23 | 驗收方式 | **TDD + typecheck + build + E2E 人工審查截圖**：沿用 dev-ssh-server + wrangler dev + playwright-mcp，三視圖（登入/連線管理/工作階段）各拍截圖供使用者人工視覺審查；不做像素 diff |
| D24 | 變更範圍 | **三視圖全部**：登入頁、連線管理、工作階段（終端機/SFTP/監控） |

### 由 D18–D24 衍生的實作細節（依折衷原則自行裁定）

- **chart.js 取樣緩衝**：monitor.ts 加 `SampleBuffer` 純類別（環形緩衝上限 60 點＝3 分鐘歷史），可 TDD；chart.js 渲染為膠水層（編譯驗證 + E2E）。
- **連線狀態指示**：連線管理卡片顯示「連線中／已斷線」由前端跨視圖狀態判斷（active session 比對 cfg.id），不新增 Worker 欄位。
- **骨架屏**：連線列表載入中、SFTP 目錄載入中、監控首次取樣前，皆顯示骨架屏；載入完成後淡入實際內容。
- **空狀態插圖**：連線列表空時顯示 SVG 插圖＋引導文字（取代純文字提示）。
- **終端機標題列**：term-container 上方加偽標題列（顯示連線名稱＋ OS 標籤），玻璃擬態邊框。
- **SFTP 檔案類型分色**：依副檔名給資料夾／程式碼／壓縮檔／圖片／文件等不同色彩圖示（純資料表，TDD 可測）。
- **響應式斷點**：沿用既有 720px，擴充至 480px（手機直）與 1024px（平板橫）三段。
- **字型字重**：Inter 400/600/700、Noto Sans TC 400/600（中文 700 視覺過粗，不載入）。
- **CSS 變數擴充**：liquid-glass.css 加 `--glass-bg-strong`、`--shadow-soft`、`--shadow-glow`、`--transition-base`、`--radius-sm/lg`、`--spacing-*` 等設計 token。
- **不變**：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出（D15–D17）等既有契約不動。

## 六、SFTP 文字檔線上預覽（2026-08-22）

> 觸發：使用者「無法在線查看文字文件」。經確認為 worker-ssh SFTP 面板缺少文字檔線上預覽功能。SSH 引擎已具備 `SftpReadFile`/`jsSftpReadFile`/`SshClient.readFile()` 完整讀檔能力（前述下載功能已在用），本次僅在前端加預覽 UI 層，引擎與 API 無需改動。

| # | 議題 | 決策 |
|---|------|------|
| D25 | 預覽功能 | SFTP 面板加文字檔線上預覽：副檔名→語言映射 + highlight.js 語法高亮 + Modal 彈窗呈現 |
| D26 | 觸發方式 | **按鈕 + 點擊檔名**：每行 actions 加「預覽」按鈕；點擊非資料夾檔名也開預覽（兩入口） |
| D27 | 呈現方式 | **Modal 彈窗**：標題列（檔名 + 關閉鈕）+ `<pre><code>` 高亮內容 + 底部（複製 + 下載按鈕）；覆蓋式不破壞檔案列表狀態 |
| D28 | 語法高亮 | **引入 highlight.js**：npm install + `highlight.js/lib/core` 按需註冊 ~20 常用語言 + 動態 import 產生獨立 chunk（與 chart.js 同模式，維持零外部 CDN 慣例 D21） |
| D29 | 載入時機 | **點擊預覽時才動態 import**（預覽是 optional 功能，不連線預載，比 chart.js 更省資源） |
| D30 | 語言指定 | **副檔名→語言映射表**（純資料，TDD）；未匹配 fallback `highlightAuto`（用已註冊語言自動偵測） |
| D31 | 檔案大小上限 | **1MB**（超過提示「檔案過大（>1MB），請下載後查看」；`SftpReadFile` 是全檔讀取，過大會卡瀏覽器） |
| D32 | 二進位檔案處理 | `fileKindOf=binary`（exe/bin/so/dll 等）直接拒絕預覽提示「不支援預覽此類型檔案」；未知類型嘗試 `TextDecoder` 解碼，含大量 U+FFFD 替換字元則判定為二進位拒絕 |
| D33 | 編輯儲存 | **不在範圍**（使用者只說「查看」）；預覽為唯讀 |

### 由 D25–D33 衍生的實作細節（依折衷原則自行裁定）

- **註冊語言範圍**：javascript/typescript/python/go/bash/shell/json/yaml/xml/markdown/html/css/sql/c/cpp/java/rust/php/ruby/lua/diff（~20 個，覆蓋 SFTP 常見文字檔；體積可控）。
- **Modal DOM 建立方式**：JS 動態建立（不修改 index.html 結構），關閉時移除 DOM 節點；backdrop 點擊關閉 + Esc 鍵關閉。
- **複製按鈕**：`navigator.clipboard.writeText`，成功 toast「已複製」。
- **可預覽判斷函數**：`isPreviewable(name, isDir)` 純函數 TDD——`isDir` false 且 `fileKindOf` 非 `binary` 且副檔名在可預覽白名單或為未知文字類型時回 true。
- **不變**：SftpReadFile 全檔讀取 API、SFTP 既有下載/上傳/重新命名/刪除/建目錄功能、零表情符號輸出（D15–D17）、Liquid Glass 主題。

## 七、SFTP 文字檔線上編輯（2026-08-23）

使用者原始需求：「可以在線查看了,為什麼不能在線編輯」。經三輪 question 工具澄清確認 D34–D46。

| # | 議題 | 決策 |
|---|------|------|
| D34 | 編輯器 | **CodeMirror 6**（~150KB 延遲 chunk），帶行號、語法高亮、查找替換、Tab 鍵縮排；esbuild splitting 自動延遲載入，與 chart.js/highlight.js 同模式 |
| D35 | 儲存方式 | **兩者皆可**：覆蓋原檔（預設）+ 另存新檔（同目錄+檔名輸入） |
| D36 | 可編輯檔案類型 | **所有可預覽文字檔**（與 isPreviewable 相同條件：非資料夾、非 binary/archive/image、≤1MB） |
| D37 | 編輯檔案大小上限 | **1MB**（與預覽相同；超過提示下載後本地編輯） |
| D38 | 未儲存離開提示 | **提示確認**：瀏覽器 confirm「有未儲存的變更，確定離開？」 |
| D39 | 進階功能 | **語法高亮即時顯示 + 行號 + Tab 鍵縮排**（CodeMirror 6 內建，沿用 highlight-language.ts 語言映射） |
| D40 | 編輯模式進入方式 | **預設編輯模式**：既有「預覽」（eye）按鈕改為「編輯」（pencil）按鈕，點擊直接開編輯 Modal；Modal 標題列加唯讀/編輯切換按鈕（eye↔pencil） |
| D41 | 另存新檔細節 | **同目錄+檔名輸入**：預設「原檔名.copy.原副檔名」（如 config.conf → config.copy.conf），使用者可編輯；檔名已存在時拒絕並提示；檔名驗證不能含 /\:*?"<>|、不能空、長度 ≤255 |
| D42 | 覆蓋原檔前確認 | **二次確認**：點「儲存」後彈瀏覽器 confirm「確認覆蓋原檔？」 |
| D43 | Tab 鍵行為 | **2 Space**（與 JSON/YAML 慣例一致）；Shift+Tab 反縮排 |
| D44 | 存檔後行為 | **Modal 保持開啟+狀態提示**：標題列顯示「已儲存」綠色提示 2 秒淡出，繼續編輯；不重新整理 SFTP 列表（避免打斷當前位置） |
| D45 | 預覽與編輯 UI 整合 | **預覽改為編輯+Modal 內切換**：既有 eye 按鈕改為 pencil 按鈕（iconButton）；Modal 標題列加唯讀/編輯切換按鈕；預設編輯模式 |
| D46 | 唯讀切換行為 | **保留編輯內容**：切到唯讀時不丟失未儲存編輯（仍在記憶體）；切回編輯可繼續 |

### 由 D34–D46 衍生的實作細節（依折衷原則自行裁定）

- **CodeMirror 6 套件**：`npm install codemirror @codemirror/lang-javascript @codemirror/lang-typescript @codemirror/lang-python @codemirror/lang-go @codemirror/lang-json @codemirror/lang-yaml @codemirror/lang-xml @codemirror/lang-markdown @codemirror/lang-css @codemirror/lang-sql @codemirror/lang-cpp @codemirror/lang-java @codemirror/lang-rust @codemirror/lang-php @codemirror/lang-ruby @codemirror/lang-lua @codemirror/lang-python @codemirror/commands @codemirror/view @codemirror/state @codemirror/language @codemirror/autocomplete @codemirror/search`（沿用 highlight-language.ts 20 語言清單，未匹配 fallback 純文字無高亮）。
- **動態載入**：點擊「編輯」按鈕才 `await import('codemirror')` + 語言套件，與 highlight.js 同為延遲 chunk；不連線預載。
- **ssh-engine.ts SshClient.writeFile**：需新增（呼叫 WASM engine.sftpWriteFile；go-ssh/main.go 已有 jsSftpWriteFile 橋接 + go-ssh/sftpfs.go SftpWriteFile 已存在）；簽章 `writeFile(connId: string, path: string, data: Uint8Array): Promise<void>`。
- **編輯器狀態管理**：CodeMirror EditorState.create({ doc: text, extensions: [...] })；extensions 包含 lineNumbers、highlightActiveLine、history、indentUnit.of("  ")、keymap.of([defaultKeymap, historyKeymap, indentWithTab, searchKeymap])、language.of(languageDescription)。
- **存檔流程**：編輯內容 → `new TextEncoder().encode(doc.toString())` → `client.writeFile(connId, path, bytes)` → 成功 toast「已儲存」+ 標題列綠色提示 2 秒淡出；失敗 toast 顯示錯誤訊息。
- **另存流程**：prompt 輸入新檔名（預設原檔名.copy.原副檔名）→ 驗證檔名（不含 /\:*?"<>|、非空、≤255）→ `client.writeFile(connId, joinPath(currentPath, newName), bytes)` → 成功後 Modal 標題更新為新檔名、原檔不動、繼續編輯新檔。
- **唯讀/編輯切換**：標題列右側加切換按鈕（iconButton eye↔pencil）；切換時 `editor.dispatch({ effects: EditorState.readOnly.of(isReadonly) })`；唯讀時保留 doc 內容。
- **未儲存偵測**：比較 `editor.state.doc.toString()` 與原始載入內容；有差異時關閉 Modal 觸發 confirm。
- **鍵盤快捷鍵**：Ctrl+S 儲存（覆蓋原檔）、Ctrl+Shift+S 另存新檔、Esc 關閉（未儲存提示）。
- **不變**：SftpReadFile/SftpWriteFile 既有 API、SFTP 既有下載/上傳/重新命名/刪除/建目錄功能、preview-modal.ts 既有預覽 Modal 結構（改為編輯 Modal 但保留 backdrop/標題列/關閉三路架構）、零表情符號輸出（D15–D17）、Liquid Glass 主題、零外部 CDN 慣例（D21）。

## 八、SFTP 文字檔瀏覽器渲染預覽（2026-08-23）

使用者原始需求：「在md和html這類文件中的彈出ui增加一個小按鈕,讓文件可以在瀏覽器渲染」。

### 決策表（D1–D16）

| # | 議題 | 決策 |
|---|------|------|
| D1 | 渲染顯示方式 | Modal 內切換分頁（原始碼/渲染預覽，點擊按鈕切換，不開新視窗） |
| D2 | 支援檔案類型 | markdown .md/.markdown + HTML .html/.htm + SVG .svg + CSV .csv |
| D3 | Markdown 渲染器 | markdown-it（~70KB，npm install） |
| D4 | HTML 安全 | Markdown 用 DOMPurify（需插入 DOM），HTML 用 sandbox iframe（完全隔離 JS） |
| D5 | 渲染唯讀 | 純唯讀預覽（切回原始碼繼續編輯） |
| D6 | 按鈕位置 | 標題列（eye 圖示，與「切換唯讀」同排） |
| D7 | 渲染樣式 | 沿用 Liquid Glass 暗色主題（暗色背景+淺色文字） |
| D8 | 渲染即時性 | 切換即渲染（含未儲存變更） |
| D9 | CSV 渲染 | PapaParse 函式庫（npm install papaparse ~45KB，完整 RFC 4180 支援） |
| D10 | Markdown 程式碼高亮 | 整合 highlight.js（markdown-it-highlight 外掛，已安裝 highlight.js） |
| D11 | SVG 渲染 | 直接 innerHTML + DOMPurify（SVG 自適應容器大小） |
| D12 | 未儲存切換提示 | 不提示直接渲染（切換不是離開 Modal，內容仍在記憶體） |
| D13 | DOMPurify 來源 | npm install dompurify（~20KB，動態 import 延遲載入） |
| D14 | markdown-it 外掛 | 全功能（錨點 markdown-it-anchor + 腳註 markdown-it-footnote + task list markdown-it-task-lists + emoji markdown-it-emoji + sub/sup markdown-it-sub/markdown-it-sup + deflist markdown-it-deflist，共 +6 個外掛） |
| D15 | 分頁切換 UI | 按鈕切換（標題列 eye 按鈕在「原始碼」與「渲染預覽」之間切換） |
| D16 | 預覽區滾動 | 獨立滾動（預覽區有獨立滾動條，與原始碼編輯器相同行為） |

### 衍生實作細節

- **npm install 套件**：markdown-it + markdown-it-anchor + markdown-it-footnote + markdown-it-task-lists + markdown-it-emoji + markdown-it-sub + markdown-it-sup + markdown-it-deflist + dompurify + papaparse（共 10 個套件，全部動態 import 延遲載入）。
- **渲染預覽按鈕**：edit-modal.ts 標題列加 iconButton("eye", "渲染預覽") 與 iconButton("pencil", "原始碼") 切換；eye 按鈕點擊切換到渲染預覽分頁，pencil 按鈕點擊切換回原始碼分頁。
- **渲染預覽區 DOM**：.edit-content 內加 .edit-preview 區塊（hidden 預設），切換到預覽時隱藏 .cm-editor 顯示 .edit-preview，切換回原始碼時反向。
- **Markdown 渲染**：動態 import markdown-it + 6 個外掛 + DOMPurify；markdown-it 設定 html:true + linkify:true + breaks:false；markdown-it-highlight 整合 highlight.js（已安裝）；渲染後用 DOMPurify.sanitize(html) 清理 XSS；插入 .edit-preview.innerHTML。
- **HTML 渲染**：用 sandbox iframe（sandbox="allow-same-origin" 不加 allow-scripts）；iframe.srcdoc = html；完全隔離 JS 執行與 DOM 存取。
- **SVG 渲染**：用 DOMPurify.sanitize(svgText, { USE_PROFILES: { svg: true } }) 清理；.edit-preview.innerHTML = sanitizedSvg；SVG 自適應容器大小（width:100% height:auto）。
- **CSV 渲染**：用 PapaParse.parse(text, { header: true, skipEmptyLines: true })；渲染為 <table>（thead + tbody）；表格樣式沿用 Liquid Glass 暗色主題。
- **渲染即時性**：切換到預覽時從 editor.state.doc.toString() 取當前內容渲染（含未儲存變更）；切換回原始碼時不重新載入（編輯器內容不變）。
- **渲染預覽樣式**：.edit-preview 沿用 Liquid Glass 暗色主題；padding 12px 14px；overflow:auto 獨立滾動；markdown HTML 元素（h1-h6/p/ul/ol/table/code/pre/blockquote/a/img）用暗色主題色彩；HTML iframe 內用白底黑字（瀏覽器原生渲染）。
- **不變**：edit-modal.ts 既有 CodeMirror 6 整合 + buildCustomHighlightStyle + 唯讀切換 + 存檔/另存 + 語法高亮 tok-* class + CSS .tok-link 但藍色 #60a5fa；preview-modal.ts 保留不動；零外部 CDN 慣例（D21）；零表情符號輸出（D15–D17）。

## 九、確認框 Modal 化（2026-08-23）

使用者原始需求：將專案中所有瀏覽器原生 `window.confirm` 取代為自訂 Liquid Glass 主題 Modal，與既有 `.edit-modal` / `.preview-modal` 視覺一致。

### 現況盤點

全專案共 5 處 `window.confirm` 呼叫：

| 檔案 | 行號 | 用途 | 訊息 |
|------|------|------|------|
| main.ts | 200 | 刪除連線 | `確定刪除連線「${cfg.name}」？` |
| main.ts | 438 | 斷開 SSH 連線 | `確定要斷開 SSH 連線並返回連線管理？` |
| sftp-panel.ts | 226 | 刪除檔案/資料夾 | `確定刪除${kind}「${entry.name}」？此操作不可復原。` |
| edit-modal.ts | 485 | 覆蓋原檔二次確認 | `確定覆蓋原檔 ${opts.filename}？` |
| edit-modal.ts | 536 | 未儲存離開提示 | `有未儲存的變更，確定要關閉嗎？` |

### 決策表（D1–D8）

| # | 議題 | 決策 |
|---|------|------|
| D1 | 函式簽名 | `openConfirmModal(opts: { message: string; title?: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean>`，帶選項的物件簽名，與 openEditModal/openPreviewModal 一致 |
| D2 | 關閉路徑 | backdrop 點擊「不關閉」、Esc=取消、確認鈕=確認、取消鈕=取消（與既有 edit-modal 不同；edit-modal backdrop 會關閉） |
| D3 | 危險動作樣式 | `danger=true` 時確認鈕紅色（.btn-danger）；刪除連線(main.ts:200)、刪除檔案(sftp-panel.ts:226)、覆蓋原檔(edit-modal.ts:485) 三處傳 danger=true；斷開 SSH(main.ts:438) 與未儲存離開(edit-modal.ts:536) 不傳 danger，用主色 |
| D4 | Modal 疊加層級 | confirm-modal z-index 高於 edit-modal，允許從 edit-modal 內呼叫時疊加。多層 backdrop 視覺加深可接受 |
| D5 | sftp-panel 介面變更 | `SftpPanelOptions.confirm?` 從 `(message: string) => boolean` 改為 `(message: string) => Promise<boolean>`；`remove()` 加 `await`。屬內部介面無外部依賴 |
| D6 | 既有 Modal 重構 | **只新增 confirm-modal，不動 preview-modal/edit-modal**。遵守 OREO「不擴張需求範圍」原則 |
| D7 | 焦點初始位置 | **不預設選中任何按鈕**。焦點放 backdrop 或訊息容器（.confirm-content），使用者必須主動 Tab 或點擊。避免 Enter 誤觸 |
| D8 | Esc 疊加行為 | **內層先處理、外層暫停**。confirm-modal 開啟時暫停 edit-modal 的 keydown 監聽器，關閉後恢復。業界標準做法 |

### 依既有慣例直接裁定（不另追問）

- **預設按鈕文字**：確定 / 取消（與既有 UI 繁中一致）
- **動畫**：fadeIn（與既有 preview-modal 的 previewFadeIn/previewIn 一致，加 prefers-reduced-motion 降級）
- **無障礙**：`role="alertdialog" aria-modal="true" aria-label=訊息`（alertdialog 業界標準，dialog 不夠語意化）
- **檔案命名**：`src/frontend/confirm-modal.ts`（與 preview-modal.ts / edit-modal.ts 命名一致）
- **DOM 來源**：JS 動態建立（與 preview-modal/edit-modal 一致，不在 index.html 預放）
- **測試層級**：TDD 強制；獨立測試模組 `test/unit/frontend/confirm-modal.test.ts`（vitest node 環境，DOM 行為）
- **多個 confirm 同時開啟**：不強制單例。每次呼叫建立新 Modal，多層 backdrop 自然疊加（與業界行為一致）
- **圖示**：confirm-modal 不用 icon（與既有 preview-modal 一致；edit-modal 有圖示但那是標題列裝飾）

### 影響範圍

- 新增：`src/frontend/confirm-modal.ts`（openConfirmModal 實作）
- 新增：`test/unit/frontend/confirm-modal.test.ts`（TDD 測試）
- 修改：`src/frontend/main.ts`（line 200 刪連線、line 438 斷開 SSH 改為 await openConfirmModal）
- 修改：`src/frontend/edit-modal.ts`（line 485 覆蓋原檔、line 536 未儲存離開改為 await openConfirmModal；整合 Esc 監聽器暫停/恢復）
- 修改：`src/frontend/sftp-panel.ts`（line 39-58 介面型別變更、line 226 remove 加 await）
- 修改：`src/frontend/styles/liquid-glass.css`（新增 .confirm-* 樣式區段）

### 驗收條件

1. 全專案零 `window.confirm` 直接呼叫（grep 結果為 0；sftp-panel.ts 的 fallback `?? ((m) => window.confirm(m))` 保留作為測試注入失敗時的安全網，不計入）
2. `openConfirmModal` 簽名與 D1 一致
3. danger=true 三處確認鈕紅色樣式
4. backdrop 點擊不關閉；Esc=取消；確認鈕=確認；取消鈕=取消
5. 從 edit-modal 內開啟 confirm-modal 時，按 Esc 只關閉 confirm-modal，不連帶關閉 edit-modal
6. 開啟時焦點不預設選中按鈕
7. 預設按鈕文字「確定」「取消」
8. role="alertdialog" aria-modal="true"
9. TDD：confirm-modal.test.ts 在 RED 階段因 openConfirmModal 未實作而失敗；GREEN 階段全綠
10. 回歸：前端全數測試通過、typecheck 0 錯、build 成功、check:split OK
11. 不變契約：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出、字型自托管零外部 CDN、第三輪美化（D18–D24）、SFTP 預覽（D25–D33）、SFTP 編輯（D34–D46）等既有契約全數保留

### 完成狀態（2026-08-23）

✅ 已完成並通過回歸驗證：
- 新增 `src/frontend/confirm-modal.ts`（openConfirmModal 實作；Liquid Glass 風格；capture 攔截實現 D8 Esc 疊加）
- 新增 `test/unit/frontend/confirm-modal.test.ts`（TDD 31 測試；jsdom per-file 環境；涵蓋 D1-D8 全行為契約）
- 修改 `src/frontend/main.ts`（line 200 刪連線 danger=true、line 438 斷開 SSH、line 401 SFTP confirm 注入）
- 修改 `src/frontend/edit-modal.ts`（line 485 覆蓋原檔 danger=true；line 536 未儲存離開 fire-and-forget async + confirming 旗標防重入）
- 修改 `src/frontend/sftp-panel.ts`（介面 confirm? 改 Promise<boolean>；fallback 保留 window.confirm 作安全網；remove 加 await）
- 修改 `src/frontend/styles/liquid-glass.css`（.confirm-* 樣式區段；z-index 240 高於 .edit-backdrop 220）
- devDependencies 新增 jsdom ^29.1.1（供 confirm-modal DOM 測試）

驗證結果：
- 前端測試 15 檔 226/226 全綠（含 confirm-modal 31 tests）
- typecheck 0 錯（worker + frontend）
- build 成功（wasm + worker 17.5kb + client）
- check:split OK（app.js 92KB）
- 零 window.confirm 直接呼叫（5 處全在註解或 fallback 安全網，符合驗收條件 1）

---

## 十、按鈕純文字化（2026-08-23）

> 來源：使用者 m0062 要求「把 SFTP 的『編輯』svg 換掉改成純文字，『切換唯讀/編輯』和『切換原始碼/瀏覽器渲染預覽』這兩個 svg 也改成純文字」。

### 現況盤點（3 處 SVG 按鈕）

| # | 按鈕 | 位置 | 原 SVG | 雙態 |
|---|------|------|--------|------|
| 1 | SFTP「編輯」 | `sftp-panel.ts:162-166`（`iconButton("pencil", "編輯", ...)`） | pencil | 無（固定） |
| 2 | 切換唯讀/編輯 | `edit-modal.ts:225-230`（初始 eye）；`351-352` setReadonly 切換 | eye ↔ pencil | 是 |
| 3 | 切換原始碼/預覽 | `edit-modal.ts:234-241`（初始 eye）；`364-378` togglePreview 切換 | eye ↔ pencil | 是 |

註：`iconButton`（sftp-panel.ts:194-208）與兩個 toggle 按鈕（edit-modal.ts）原本皆 class `btn btn-ghost btn-sm btn-icon`（方型鈕）；同列「重新命名/刪除/下載」用 `actionButton`（純文字鈕，無 btn-icon）。

### 決策表

| # | 議題 | 決策 | 來源 |
|---|------|------|------|
| D1 | 雙態文字邏輯 | **顯示「目前狀態」**（非下一步動作） | 使用者答 Q1 |
| D2 | 按鈕 class | **移除 `.btn-icon`**，改 `btn btn-ghost btn-sm`（純文字鈕，與 `actionButton` 一致） | 使用者答 Q2 |
| D3 | 變更範圍 | **只改指定的三個**；其他 icon 按鈕（saveAs/save/close/dl、sftp-panel 工具列上傳/新增/重新整理）保留原樣 | 使用者答 Q3 |

### 依既有慣例直接裁定

| 項目 | 裁定 | 理由 |
|------|------|------|
| 文字內容（單態） | SFTP「編輯」固定「編輯」 | 與同列 `actionButton`（重新命名/刪除/下載）風格一致 |
| 文字內容（雙態唯讀/編輯） | 可編輯時「編輯中」、唯讀時「唯讀中」 | 顯示目前狀態（D1）；動作狀態需「中」區別動作本身 |
| 文字內容（雙態原始碼/預覽） | 原始碼時「原始碼」、預覽時「預覽」 | 顯示目前狀態（D1）；模式名本身為名詞，不加「中」 |
| aria-label | **移除** | 純文字按鈕可見文字即為 accessible name；aria-label 與可見文字重複，移除避免冗餘（與 `actionButton` 慣例一致） |
| title | **保留**作 tooltip | 提供完整描述（如「切換唯讀/編輯」）有助無障礙；純文字按鈕保留 title 無害 |
| ui-icons.ts 的 eye/pencil 路徑 | **保留** | 圖示庫資料表，移除需同步改 `ui-icons.test.ts`（範圍擴張）；保留作未來用，TS 不報 dead code |
| 事件監聽 | **不動** | `toggleReadonlyBtn.addEventListener("click", () => setReadonly(!isReadonly))`（line 533）與 `togglePreviewBtn.addEventListener("click", () => togglePreview())`（line 534）事件邏輯不變 |
| 測試層級 | **依 OREO 例外條款** | DOM 膠水層無現成測試模組（依 D12 慣例）；變更為 replaceChildren(iconElement) → textContent + className 移除 btn-icon，靠 typecheck + build + 人工審查驗證 |

### 影響範圍

- 修改：`src/frontend/sftp-panel.ts`（line 162-166 `iconButton("pencil","編輯",...)` → `actionButton("編輯",...)`）
- 修改：`src/frontend/edit-modal.ts`（line 225-230 toggleReadonlyBtn 初始內容 + class；line 234-241 togglePreviewBtn 初始內容 + class；line 351-352 setReadonly 文字雙態；line 364-378 togglePreview 文字雙態）
- 不動：`src/frontend/ui-icons.ts`（eye/pencil 路徑保留）
- 不動：其他按鈕（saveAs/save/close/dl、sftp-panel 工具列）

### 驗收條件

1. 三個按鈕零 SVG（grep `iconElement("eye")|iconElement("pencil")` 在 edit-modal.ts/sftp-panel.ts 指定位置為 0）
2. 三個按鈕 class 為 `btn btn-ghost btn-sm`（無 `btn-icon`）
3. SFTP「編輯」按鈕可見文字「編輯」
4. 切換唯讀/編輯按鈕：可編輯時「編輯中」、唯讀時「唯讀中」
5. 切換原始碼/預覽按鈕：原始碼時「原始碼」、預覽時「預覽」
6. 三個按鈕無 aria-label（純文字可見即為 accessible name）
7. 三個按鈕 title 保留作 tooltip
8. 其他按鈕（saveAs/save/close/dl、sftp-panel 工具列）不受影響
9. 回歸：前端全數測試通過、typecheck 0 錯、build 成功、check:split OK
10. 不變契約：confirm-modal（D1-D8）、edit-modal close fire-and-forget、sftp-panel confirm 介面、WASM 引擎、Worker 位元組橋接等既有契約全數保留

### 完成狀態（2026-08-24）

已完成：
- sftp-panel.ts line 162-166：iconButton("pencil","編輯",...) → actionButton("編輯",...)（移除 btn-icon + aria-label + SVG）
- edit-modal.ts line 225-230 toggleReadonlyBtn 初始：移除 btn-icon + aria-label；textContent="編輯中"
- edit-modal.ts line 234-241 togglePreviewBtn 初始：移除 btn-icon + aria-label；textContent="原始碼"
- edit-modal.ts line 351-352 setReadonly 切換：replaceChildren(iconElement) + setAttribute(aria-label) → textContent = value ? "唯讀中" : "編輯中"
- edit-modal.ts line 364-378 togglePreview 切換：兩處 replaceChildren(iconElement) → textContent = "預覽" / "原始碼"

驗證結果：
- 前端測試 15 檔 226/226 全綠（與前一任務相同，本任務無新增測試——依 OREO 例外條款，DOM 膠水層無現成測試模組，依 D12 慣例靠 typecheck+build+人工審查）
- typecheck 0 錯（worker + frontend）
- build 成功（wasm + worker 17.5kb + client）
- check:split OK（app.js 93.8KB，比前一任務 92KB +1.8KB；terminal 283.6KB 不變）

例外聲明（OREO）：
- edit-modal.ts/sftp-panel.ts 按鈕純文字化變更無現成測試覆蓋（14 個測試檔無 edit-modal.test.ts/sftp-panel.test.ts，依 D12 慣例 DOM 膠水層靠 typecheck+build+E2E；edit-modal 依賴 CodeMirror 動態 import，jsdom 環境下補測試成本高）。靠 typecheck+build+人工審查驗證
- ui-icons.ts eye/pencil 路徑保留（圖示庫資料表，移除需同步改 ui-icons.test.ts 擴張範圍；TS 不報 dead code）

例外聲明（OREO）：edit-modal.ts close 行為變更（sync window.confirm → fire-and-forget async openConfirmModal）無現成測試覆蓋（14 個測試檔無 edit-modal.test.ts，依 D12 慣例 DOM 膠水層靠 typecheck+build+E2E；edit-modal 依賴 CodeMirror 動態 import，jsdom 環境下補測試成本高）。靠 typecheck+build+人工審查驗證。

---

## 十一、自主疊代升級：正確性、生命週期與安全強化（2026-08-24）

> 觸發：使用者「自主疊代升級」。本輪維持既有功能與公開契約，不新增無關功能，修復唯讀審查已確認的八項問題。

### 已確認決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | 本輪範圍 | 全部已確認問題：DELETE 204 解析、SFTP Promise、連線生命週期、WASM 載入重試、KV 分頁、production debug、登入限流、SSH host key 驗證 |
| D2 | SSH host key | 採 TOFU：首次連線顯示 SHA-256 指紋並要求使用者確認；接受後保存於該連線的加密設定 |
| D3 | 指紋不一致 | 拒絕本次連線，不允許同次覆寫；連線編輯 UI 提供「重設已信任指紋」，下次連線重新確認 |
| D4 | 登入限流 | 沿用單一 KV，依來源 IP 採固定窗口：15 分鐘內最多 5 次密碼失敗；達上限回 429；成功登入清除計數 |
| D5 | E2E 環境 | 使用 `dist/dev-ssh-server.exe`／`scripts/dev-ssh-server`，目前監聽 `127.0.0.1:2222`，測試帳號由既有 fixture 定義 |
| D6 | 驗收深度 | 目標與完整自動測試、typecheck、build、split 檢查，加真實瀏覽器 SSH/SFTP E2E |

### 可觀察行為契約

1. `DELETE /api/connections/:id` 回 204 空內容時，前端視為成功並重新整理連線列表，不嘗試解析空 JSON。
2. `SshClient.writeFile/mkdir/remove/rename` 必須等待 WASM Promise 完成；rejection 必須傳回呼叫端，不得提前回成功。
3. 連線建立任一步驟失敗時，已建立的 transport/client/shell/terminal/chart/poller 必須被清理；遠端主動關閉時亦停止輪詢與釋放 UI 資源，不殘留背景工作。
4. WASM 首次載入失敗後可再次嘗試；已完成載入的 script 不會等待永不再發生的 `load` 事件。
5. 連線清單必須讀完所有 KV cursor 分頁後再解密回傳。
6. 正式前端不輸出 host、port 或傳輸資料長度等 SSH debug 資訊。
7. 登入限流只累計密碼驗證失敗；成功登入清除該來源計數。達上限時回 429 JSON 錯誤與 `Retry-After`，窗口到期後可重試。無 `CF-Connecting-IP` 的本機／測試請求使用穩定 fallback key。
8. 首次 SSH 連線顯示 host key 類型與 SHA-256 指紋；取消即拒絕連線，確認後才繼續並保存。
9. 後續連線的指紋一致時不再提示；不一致時顯示安全錯誤並拒絕，不更新已保存指紋。
10. 編輯連線時若已有信任指紋，顯示其值與明確重設操作；重設須經既有 Liquid Glass 確認 Modal，且不改動其他連線欄位。

### 驗收條件

1. 每項行為先有可穩定失敗的自動化測試（RED），再以最小實作通過（GREEN），重構後相關測試仍全綠。
2. 前端、Worker、Go 受影響測試全數通過；完整測試、typecheck、build、`check:split` 無新增錯誤。
3. 真實 E2E 至少驗證：首次指紋確認、保存後免提示重連、錯誤指紋拒絕、重設後重新確認、終端建立、SFTP 讀寫／建立／改名／刪除。
4. 不削弱 AES-GCM 連線設定加密、HMAC session、Worker 位元組橋接上限、既有 UI 主題、SFTP 編輯與預覽等既有契約。

---

## 十二、批量生成排版測試 SSH 連線（2026-08-24）

> 觸發：使用者「幫我批量生成範例ssh連接,以方便測試排版功能」。本次只寫入本機 Wrangler/KV 測試環境，不新增正式功能或生成腳本。

### 已確認需求與決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | 新增數量 | 額外新增 50 筆；不刪除、不覆寫既有連線或舊範例 |
| D2 | 可連線分布 | 25 筆使用本機 fixture：`127.0.0.1:2222`、`tester`、密碼認證；25 筆使用文件保留網域/IP，不連至真實外部主機 |
| D3 | 排版覆蓋 | 涵蓋極短、一般、長名稱，不同 username/host/port、password/privateKey 認證，以及未連線／曾連線／已斷線時間狀態 |
| D4 | 清理識別 | 所有名稱統一以 `LAYOUT-範例-` 開頭，並加入本批次唯一標記，方便後續精準清理 |
| D5 | Host key 狀態 | 50 筆皆不預先寫入 `hostKeyType` 或 `hostKeyFingerprint`，維持未信任 TOFU 狀態 |
| D6 | 寫入位置 | 直接寫入目前本機 Wrangler/KV；不建立可重複執行的專案腳本 |

### 驗收條件

1. API 回報本批次恰有 50 筆，且不影響寫入前既有連線。
2. 其中恰有 25 筆指向 `127.0.0.1:2222` 並使用 `tester` 密碼認證；其餘 25 筆只使用安全保留端點。
3. 50 筆皆以前綴 `LAYOUT-範例-` 與同一批次標記辨識，且皆無已信任 host key 欄位。
4. 名稱長度、認證型態與最近連線時間狀態具有足夠分布，可觀察桌面卡片網格、長列表、文字換行與手機單欄排版。
5. 以真實 UI 驗證桌面與手機列表可顯示、捲動且無文字或控制項重疊；不得實際嘗試連線至假端點。

---

## 十三、Worker 大量連線崩潰與 v2 加密信封升級（2026-08-24）

> 觸發：使用者回報「我怎麼感覺本地測試worker是崩潰的」。已以 52 筆連線真實重現：`GET /api/connections` 約 7 秒後本機 Wrangler/Miniflare loopback 崩潰，port 8787 消失。根因集中於 v1 每筆獨立 PBKDF2 salt、210,000 次衍生及清單全量並行解密。

### 已確認需求與決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | 修復層級 | 升級加密格式，不以降低 PBKDF2 強度、限制資料筆數或隱藏錯誤規避崩潰 |
| D2 | v2 金鑰衍生 | 使用具 domain separation 的固定 v2 KDF salt，維持 PBKDF2-SHA256 210,000 次與 AES-256-GCM；同一 `ENCRYPTION_KEY` 在 isolate 內可重用衍生金鑰 |
| D3 | 每筆隨機性 | 每筆 v2 信封仍使用獨立 96-bit 隨機 IV；信封具明確 `v2:` 版本標記，並以 AES-GCM additional data 綁定版本與用途 |
| D4 | 舊資料相容 | 無版本前綴的既有信封仍依 v1 `salt(16)+iv(12)+ciphertext/tag` 解密，不得遺失或誤判既有資料 |
| D5 | 新資料格式 | 所有 create/update 與遷移後資料一律寫入 v2；公開的 ConnectionConfig、CRUD 與 `GET /api/connections` 完整陣列契約不變 |
| D6 | 遷移方式 | 舊 v1 連線採受保護端點分批自動遷移；前端 `listConnections()` 先透明循環遷移至完成，再取得完整清單 |
| D7 | 遷移安全 | 每批工作量必須有界；只遷移可成功解密的 v1；寫回前重新確認 KV 原始值未改變，避免覆蓋同時發生的更新；損毀資料不得改寫 |
| D8 | 遷移存取 | 遷移端點須與連線 CRUD 相同，要求有效 session 與 `ENCRYPTION_KEY`；未登入回 401、缺金鑰回 500，不得洩漏明文或金鑰資訊 |
| D9 | 壓力目標 | 真實本機 Wrangler 使用 500 筆連線驗收，`GET /api/connections` 每次在 5 秒內完成，連續 10 次請求／重載成功且 Worker/port 持續存活 |
| D10 | 壓測資料 | 額外壓力資料需有唯一批次標記，驗收後精準刪除；保留使用者原有資料與上一輪 50 筆排版範例 |

### 可觀察行為契約

1. `encryptString()` 產生明確 `v2:` 信封；相同 key material 的多筆新信封只需一次 v2 PBKDF2 衍生，但因隨機 IV 仍產生不同密文。
2. v2 信封可正確 round-trip；錯誤金鑰、密文／版本／additional data 竄改及非法格式都必須失敗。
3. `decryptString()` 同時支援 v1 與 v2；另提供可辨識實際信封版本的受測介面供遷移使用。
4. `ConnectionStore.create/update` 一律寫 v2；`get/list/remove` 對 v1、v2 混合資料保持既有可觀察行為。
5. 分批遷移回應至少提供 `done`、下一游標、掃描數與實際遷移數；重複呼叫具冪等性，完成後不重寫 v2。
6. 遷移遇到同時更新時不覆寫較新的 KV 值；遇到無法解密的資料時不改寫、不回傳敏感內容，後續批次仍可繼續。
7. 前端清單流程的網路順序為零或多次遷移請求，直到 `done=true` 後才呼叫一次 `GET /api/connections`；任何非 2xx 依既有 `ApiError` 語意傳播。
8. 500 筆 v2 清單不得觸發大量 PBKDF2；解密工作須採有界併行或等價的資源控制，避免再次壓垮 workerd。

### 驗收條件

1. 每項正式行為皆先建立會因缺少目標功能而失敗的 RED 測試，再以最小實作轉為 GREEN；不得弱化既有加密斷言。
2. crypto、store、Worker HTTP 與前端 API 測試涵蓋 v2、v1 fallback、混合清單、分批進度、認證、競態保護與透明呼叫順序。
3. 真實 Wrangler 先驗證現有 v1 資料可分批遷移且 UI 清單不遺失，再建立總量 500 筆進行連續 10 次列表量測；每次須小於 5 秒且 8787 listener 不退出。
4. 壓測後刪除本輪額外資料，確認原有連線與 `LAYOUT-範例-` 批次仍存在且可讀。
5. 前端、Worker、Go 測試、typecheck、build 與 `check:split` 均無新增錯誤；Windows/Miniflare 既有環境失敗須與產品行為分開記錄，不得誤報通過。
6. 安全審查確認：PBKDF2 迭代數未降低、AES-GCM IV 不重用、v1/v2 格式不可混淆、遷移不覆蓋併發更新、日誌與 API 不洩漏 secret。

---

## 十四、D1 主儲存、巢狀資料夾與首次使用自動初始化（2026-08-24）

> 觸發：使用者要求「添加資料夾功能，方便整理以及減少 Worker 讀取 KV 的壓力」，並補充主畫面只讀取「未分類」連線與資料夾主機數，進入資料夾後才讀取其內容。經架構確認後，使用者決定引入 Cloudflare D1 作為資料索引與加密主儲存。

### 平台邊界

- Worker 執行期間不能自行建立 Cloudflare D1 資源或新增 binding；D1 database 必須先由 Wrangler／控制台建立並綁定。
- 本次建立可直接使用的本機 D1 與正式部署設定範本；正式 `database_id` 由部署者建立 D1 後填入，不在本次操作遠端 Cloudflare 資源。
- D1 binding 存在後，Worker 會在第一次登入成功時自動建立／升級 tables、indexes 與 schema version，並自動遷移既有 KV 連線。

### 已確認需求與決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | 主資料庫 | D1 作為資料夾與 SSH 連線的唯一主儲存；KV 僅保留 OS cache、登入限流等快取型資料 |
| D2 | 加密邊界 | D1 明文只保存隨機 ID、parent/folder 關聯、排序、遞迴主機數與時間等結構欄位；資料夾名稱、連線名稱、host、username、password、privateKey、passphrase、host key 等全部由 Worker AES-GCM 加密後保存 |
| D3 | 同層唯一名稱 | 同一父層的資料夾名稱忽略大小寫後不可重複；D1 只保存由專用衍生 HMAC key 產生的 opaque name token 作唯一索引，不保存名稱明文 |
| D4 | 資料夾層級 | 支援巢狀資料夾，最多 8 層；必須阻擋循環、移入自身、移入後代及超過深度上限 |
| D5 | 未分類 | 缺少 folder 關聯的既有與新連線屬於虛擬「未分類」，不建立實體資料夾 row |
| D6 | 主機數快取 | 每個資料夾保存包含自身及所有後代資料夾的遞迴 SSH 主機總數；create/delete/move 必須在同一 D1 交易批次更新受影響祖先鏈 |
| D7 | 主畫面讀取 | 主畫面只讀取未分類連線的密文資料，以及頂層資料夾的名稱與快取主機數；不得讀取或解密資料夾內的連線 |
| D8 | 進入資料夾 | 進入資料夾後才讀取該資料夾的直接連線與直接子資料夾；子資料夾僅顯示名稱與遞迴主機數，未進入前不讀其連線 |
| D9 | 完整 API 相容 | 保留既有無範圍 `GET /api/connections` 完整陣列契約；新增範圍 API 供 UI 日常使用，避免一般主畫面全量讀取 |
| D10 | 連線整理 | 每張卡片提供移至資料夾選單；支援多選批量移動；桌面支援拖放移動，手機以選單／多選作可靠替代 |
| D11 | 資料夾整理 | 資料夾可建立子資料夾、重新命名、以選單移動及桌面拖放移動；排序採穩定結構欄位，名稱顯示與比較在 Worker 解密後處理 |
| D12 | 刪除空資料夾 | 空資料夾可直接確認刪除 |
| D13 | 刪除非空資料夾 | 顯示獨立 Liquid Glass 三選項 UI，內容包含遞迴主機數與直接子資料夾數；按鈕固定為「全部刪除」「只刪除資料夾」「取消」 |
| D14 | 全部刪除語意 | 遞迴刪除目標資料夾、全部後代資料夾及其中所有 SSH 連線，並正確扣除祖先的遞迴主機數 |
| D15 | 只刪資料夾語意 | 只刪除目標資料夾；直接連線與直接子資料夾提升到其父層，頂層則提升到未分類／根層；後代結構保持，深度同步減一 |
| D16 | 初始化觸發 | 登入頁保持可用；登入成功後先檢查 D1 bootstrap 狀態，未完成時以全螢幕遮罩阻擋主畫面及所有連線 CRUD |
| D17 | 初始化進度 | 採短輪詢、分批、可恢復流程；遮罩顯示當前階段、百分比、已處理／總筆數與重試按鈕，不提供略過或取消 |
| D18 | 初始化階段 | 至少包含 schema 建立／升級、KV 掃描、資料遷移、索引與數量重建、解密與 ID 驗證、舊 KV 清理、完成 |
| D19 | 失敗語意 | 初始化失敗時保持遮罩並顯示不含 secret 的錯誤摘要；可從持久化進度冪等重試，不退回 KV 唯讀或雙路寫入 |
| D20 | 版本化升級 | 初始化器同時是未來 D1 schema migration runner；使用 schema version 與 bootstrap state，頁面重整、Worker 重啟或多分頁競爭時只能有一個有效執行租約，其他請求讀取進度 |
| D21 | KV 遷移 | 既有 `conn:*` v1/v2 密文遷移至 D1；所有既有連線歸未分類。必須逐批、可續跑、冪等，並在 D1 row 數、ID 集合與逐筆解密驗證全部成功後才刪除舊 KV `conn:*` |
| D22 | 遷移後清理 | 驗證成功後立即刪除舊 KV 連線資料，不保留 conn:* 回復副本；刪除前任何錯誤都不得改動舊 KV |
| D23 | UI 導覽 | 連線主畫面新增資料夾導覽區、麵包屑、建立／重新命名／移動／刪除控制；沿用 Liquid Glass 暗色主題與既有 native dialog top-layer 規則 |
| D24 | 壓力驗收 | 總量 500 筆、10 個含巢狀結構的資料夾；主畫面與任一資料夾範圍讀取各低於 2 秒，連續切換 10 次成功且 Worker listener 存活；完整列表 API 維持既有低於 5 秒 |

### 資料與一致性契約

1. D1 至少包含 `schema_migrations`、`bootstrap_state`、`folders`、`connections`；所有 SQL 使用 prepared statements，查詢欄位建立必要 indexes。
2. `folders` 保存 `id`、`parent_id`、加密名稱、opaque sibling-name token、遞迴主機數、排序與時間；根層唯一性不得依賴 SQLite `NULL` unique 的寬鬆語意。
3. `connections` 保存 `id`、nullable `folder_id`、加密 connection payload、排序與時間；`folder_id IS NULL` 即未分類。
4. 資料夾名稱使用與 connection payload 分離的加密用途／AAD；name token 使用獨立 domain-separated HMAC key，不得重用 AES key 作 HMAC。
5. 連線 create/delete/move、批量 move、資料夾 move/delete 必須使用 D1 transaction/batch 維持 row、關聯與祖先快取數量一致；任何 statement 失敗整批不得留下部分狀態。
6. 資料夾移動需驗證目標存在、深度上限與無循環；遞迴數量從舊祖先鏈扣除並加到新祖先鏈。
7. 快取數量可由結構化 repair/rebuild 流程重新計算；bootstrap 完成前必須執行一次全量校驗，日常讀取不得以解密全部連線重新計數。
8. 同層名稱 token 唯一約束、資料夾 parent foreign key 與 connection folder foreign key 必須由 schema／交易保護；刪除策略不得產生孤兒 row。
9. D1 Sessions/bookmark 只在需要跨請求 read-after-write 時使用；單次一致性變更優先放入同一 `batch()` 交易。

### UI 可觀察行為

1. 登入成功且 bootstrap 未完成時，使用者只看到初始化遮罩；完成後自動進入主畫面。
2. 初始化遮罩在頁面重整後恢復真實進度；失敗時保留階段、筆數與重試，不顯示密文、SQL、secret 或完整內部 stack。
3. 主畫面顯示未分類連線卡片與頂層資料夾；資料夾顯示遞迴主機數。進入資料夾顯示麵包屑、直接子資料夾與直接連線。
4. 卡片選單、多選批量移動及拖放完成後，來源／目標畫面與所有祖先數量立即更新；API 失敗則 UI 回復原狀並顯示錯誤。
5. 拖曳資料夾到自身／後代、超過 8 層或重複同層名稱時明確拒絕，不改動資料。
6. 非空資料夾刪除 UI 必須同時提供三個明確按鈕；「全部刪除」為 danger 樣式，「只刪除資料夾」不得刪除任何連線。
7. 手機不依賴拖放才能完成操作；卡片選單、多選與資料夾選單在窄螢幕可完整操作且無重疊。

### 驗收條件

1. 每項正式行為依 RED → GREEN → REFACTOR 完成；加密、初始化、資料夾樹、計數、移動、刪除、API 與 UI 純邏輯均有自動測試。
2. 建立本機 D1、Wrangler binding 與可重複的 schema/bootstrap 測試環境；正式設定只提供 database binding 範本，不建立遠端資源。
3. 使用既有 52 筆 KV 資料真實驗證登入後遮罩、進度續跑、D1 遷移、完整驗證、舊 KV 刪除與未分類列表不遺失。
4. 壓測建立總量 500 筆、10 個多層資料夾，驗證遞迴數量精確；主畫面與 10 次資料夾切換每次低於 2 秒，完整列表低於 5 秒，port/listener 不退出。
5. 真實 E2E 覆蓋建立 8 層樹、重複名稱拒絕、建立／重新命名／選單移動／多選移動／拖放移動、循環與第 9 層拒絕、三選項刪除、手機替代操作、重整後狀態保持。
6. 驗證 D1 中 SSH host、username、password、privateKey、passphrase、host key、資料夾名稱及連線名稱均不可見明文；KV 遷移清理不得刪除 OS cache 或登入限流資料。
7. 前端、Worker、Go 測試、typecheck、build、check:split、LSP 與真實 Wrangler E2E 均無新增錯誤；任何 D1 本機 runtime 限制須明確記錄。

## 十五、API 憑證脫敏與純 Worker 後端 SSH（2026-08-24）

### 已確認決策

1. 所有一般 API 回應（完整列表、資料夾範圍、單筆讀取、建立／更新回應、bootstrap 與錯誤回應）都不得包含 `password`、`privateKey` 或 `passphrase` 明文；只回傳非敏感連線欄位與憑證狀態。
2. 編輯既有連線時，密碼、私鑰與 passphrase 欄位一律保持空白；空白表示保留 D1 中原值，不得用空字串覆寫。
3. UI 提供獨立且需危險確認的「清除已儲存憑證」操作。清除後保留主機設定，但標記為憑證缺失並禁止連線，直到使用者提供符合目前 `authType` 的替代憑證。
4. 建立連線或切換 `authType` 時必須提供相符憑證；一般儲存不得產生意外的不完整認證設定。
5. SSH、shell、exec、監控與 SFTP 全部移至後端；瀏覽器不得再取得解密後憑證，也不得保留瀏覽器 Go/WASM SSH fallback。
6. 後端限定使用純 Cloudflare Worker／Durable Object，不使用 Cloudflare Container 或外部 Go 服務。Worker 可在記憶體解密 D1 憑證，並只透過 Durable Object 私有 binding／RPC 傳入後端工作階段記憶體；不得寫入日誌、DO storage、KV、回應或瀏覽器儲存空間。
7. 純 Worker 路徑先設 Go WASM 可行性閘門：必須在 Durable Object 中載入後端 Go SSH WASM，經 `cloudflare:sockets` 對真實 fixture 完成 host-key 驗證、password auth、互動 shell 與 SFTP。任一核心能力不成立時停止本需求並報告阻礙，不得暗中改用 Container、外部服務或瀏覽器 fallback。
8. SSH 工作階段連線期間使用非休眠 Durable Object；平台回收、部署或物件重啟造成的 TCP 中斷不可宣稱原地續接。
9. 非預期 transport／平台暫時性中斷採最多 3 次自動重連，延遲依序為 1、2、4 秒。使用者明確斷線、憑證缺失、認證失敗、TOFU 取消或 host key 不一致不得自動重試。
10. 自動重連成功後建立新的 SSH 與 shell；終端顯示明確分隔訊息，恢復原分頁、SFTP 路徑與監控。重連期間停用終端輸入且不緩衝、不重送任何按鍵或命令；三次失敗後回到手動重連。

### 安全與資料契約

1. 公開 `ConnectionConfig` 回應改為不含 secret 的 DTO，至少包含 `credentialState: "ready" | "missing"`；不得以遮罩字串、固定星號或空字串假裝回傳 secret。
2. 建立／替換憑證的請求可經 HTTPS 傳入新值，但成功與失敗回應不得回顯；前端提交後立即清空 secret input 與暫存變數。
3. 只有明確的危險清除欄位／端點可刪除憑證；一般 PATCH 中 secret 缺失或空白皆表示保留。清除與替換必須在 D1 單次一致性交易內完成。
4. 後端工作階段建立 API 只回不透明 session id、狀態與 WebSocket 所需非敏感資訊。瀏覽器與 DevTools network response 不得出現已儲存憑證。
5. Durable Object 不持久化 secret；記憶體中的認證資料只保留到連線建立完成或工作階段結束，錯誤、metrics、trace 與 console 不得包含 secret、私鑰內容或 passphrase。
6. TOFU 仍由後端 SSH handshake 執行。首次 host key 的類型與 SHA-256 指紋可作為非敏感 challenge 傳給瀏覽器確認；確認後由 Worker 更新 D1。已信任不一致時後端阻擋且不得覆寫。
7. Browser 與 Durable Object 間使用具版本的 WebSocket RPC，至少涵蓋 shell input/output/resize、exec、SFTP list/stat/read/write/mkdir/remove/rename、工作階段狀態、host-key challenge 與 reconnect 狀態；訊息不得含已儲存憑證。

### 可觀察行為

1. 編輯連線時不顯示、預填或透過 API 讀回密碼、私鑰與 passphrase；只顯示是否已儲存相符憑證。
2. 空白 secret 欄位儲存後原憑證仍可使用；輸入新值才替換。危險清除確認後卡片與表單顯示憑證缺失，連線命令停用並說明原因。
3. 瀏覽器建立工作階段時只接收 session id 與非敏感事件；terminal、監控與 SFTP 對使用者維持既有功能與操作語意。
4. 非預期中斷時 UI 依序顯示第 1／2／3 次重連狀態，期間輸入不可用；成功後插入新 shell 分隔並恢復 UI 狀態，失敗後提供手動重連。
5. 明確斷線立即結束 DO、TCP、shell、SFTP 與前端資源，不觸發自動重連。

### 驗收條件

1. Go WASM 可行性閘門先以真實 `127.0.0.1:2222` fixture 證明 Durable Object 後端 password auth、host-key 驗證、shell echo 與 SFTP CRUD；未通過前不得開始全面移除瀏覽器 SSH。
2. 自動測試掃描所有 connection API response，證明不存在三個 secret 欄位及已知 fixture secret；測試空白保留、明確替換、危險清除、缺失禁連與切換 authType 驗證。
3. 真實瀏覽器 E2E 的 network、console、DOM 與 storage 不得出現已儲存 secret；後端日誌亦不得出現。
4. 真實 E2E 覆蓋首次 TOFU、相同免提示、不一致阻擋、terminal、exec、監控、SFTP CRUD、明確斷線不重連，以及強制 transport 中斷後 1／2／4 秒重試與新 shell／UI 恢復。
5. D1／資料夾第十四節的 500 筆效能與完整回歸條件仍全部成立；後端 SSH 遷移不得降低資料安全、資料夾一致性或初始化可恢復性。

## 十六、齒輪設定入口與 D1 全域偏好（2026-08-24）

### 已確認決策

1. 在連線管理主畫面右上角、登出按鈕旁新增純 SVG 齒輪按鈕作為設定入口；使用熟悉的齒輪符號，不顯示文字矩形按鈕，必須有 `aria-label="設定"`、`title="設定"`、穩定尺寸及鍵盤焦點狀態。
2. 點擊齒輪開啟原生 `<dialog>.showModal()` 設定介面，避免被其他 native dialog top layer 擋住；第一版不是空殼，必須可實際讀寫並套用設定。
3. 設定採整個面板共用一份，保存於 D1 並同步所有登入裝置；不使用 localStorage 作正式來源。
4. 主題只提供 `dark`（深色）與 `high-contrast`（高對比深色）兩種模式，預設 `dark`。
5. 終端字級允許 12–20px、step 1、預設 14px；監控更新頻率只允許 3、5、10、30 秒，預設 3 秒。
6. 自動重連提供啟用開關與 1–5 次重試次數，預設啟用、3 次。延遲依序為 1、2、4、8、16 秒；關閉時非預期中斷直接轉為手動重連，明確斷線與安全錯誤仍不得重連。
7. 所有欄位邊調整邊即時預覽：主題立即切換；目前已開啟的終端字級立即更新並重新 fit；監控頻率立即重新排程；目前 Backend SSH client 的後續重連策略立即更新。
8. 「取消」必須將表單、畫面與目前工作階段完整還原為開啟 dialog 前的設定；不得寫入 D1。「儲存」才將目前預覽值寫入 D1，成功後保留套用狀態。
9. 提供「恢復預設值」操作；按下後立即預覽預設值，但仍需按「儲存」才寫入 D1，取消時仍恢復開啟 dialog 前的設定。
10. 設定值不含認證資料，可使用 D1 明文結構欄位保存，不套 AES-GCM；仍不得與 connection secret 混存、回顯或記錄。

### D1 與 API 契約

1. 版本化 D1 schema 新增單例全域設定資料，至少包含固定 ID、`theme`、`terminal_font_size`、`monitor_interval_seconds`、`auto_reconnect_enabled`、`auto_reconnect_attempts` 與 `updated_at`；bootstrap 必須可由既有 schema 無損升級。
2. 不存在設定 row 時回傳預設設定；第一次儲存以 upsert 建立。所有欄位由 Worker 做 runtime validation，不接受未知主題、越界字級、非允許頻率、非 boolean 或 1–5 以外重試次數。
3. 新增受 session、`ENCRYPTION_KEY` 與 bootstrap-complete 保護的設定 API；GET 回完整非敏感偏好，PUT 原子保存完整設定並回保存後值。未登入回 401，bootstrap 未完成回 423，非法資料回 400。
4. 登入並完成 bootstrap 後，前端必須先取得並套用設定，再顯示連線主畫面；API 暫時失敗不得破壞登入或資料夾資料，應顯示錯誤並使用安全預設值。
5. 設定 API 回應不得包含任何 connection、credential、D1 SQL 或內部 stack；更新設定不得讀寫 connection payload。

### UI 與即時套用契約

1. 設定 dialog 至少包含：主題模式控制、12–20px 終端字級控制、3/5/10/30秒監控頻率控制、自動重連開關、1–5次重試控制、恢復預設、取消與儲存。
2. 自動重連關閉時重試次數控制保持可見但 disabled，避免設定意義不明；重新開啟時恢復先前選取次數。
3. 高對比模式透過 `document.documentElement` 的穩定 theme attribute/class 套用，涵蓋背景、文字、邊框、按鈕、dialog、folder/connection cards、terminal chrome 與狀態提示；不可只改單一顏色。
4. 對話框在桌面與 390×844 手機視圖均不得溢出或重疊；必要時內容區垂直捲動，底部命令保持可操作。
5. 終端字級預覽直接更新現有 xterm `fontSize` 並呼叫 fit；沒有 active terminal 時只更新下次建立終端的預設值。
6. 監控頻率預覽必須停止舊 timer 後以新頻率排程，不能疊加多個 poller；取消時恢復原頻率。
7. 重連策略預覽只影響後續斷線，不中斷目前 SSH；調整時不得建立額外 WebSocket 或重送任何 terminal input。
8. 主畫面每張主機卡片的多選核取框與選取工具列的「全選」不得使用瀏覽器預設外觀；保留原生 checkbox 語意與 input 作為可存取性來源，以 CSS 建立契合深色／高對比主題的穩定方形勾選控制，必須支援滑鼠、Space、鍵盤焦點、checked 與 disabled 狀態。此異動不擴張到全站其他核取框。
9. SFTP 檔案與資料夾的重新命名不得再使用 `window.prompt`；統一改用符合現有主題的原生 `<dialog>.showModal()` 輸入介面。開啟時預填完整原名稱並全選文字，Enter 確認、Escape／取消不修改；空白名稱不得送出，且既有 rename API 與錯誤語意保持不變。

### 驗收條件

1. 依 RED → GREEN → REFACTOR 完成 D1 schema/settings store、API validation、前端設定狀態、預覽/取消還原、terminal/monitor/reconnect 接線與 UI 行為測試。
2. 自動測試證明既有 D1 schema 可升級、預設值正確、全域設定可持久化、無效值拒絕、API auth/bootstrap guard 正確。
3. 前端測試證明取消不寫入且完整還原、儲存只寫一次、恢復預設可預覽、重連關閉會禁用次數控制，以及目前 session 的字級/監控/reconnect policy 可更新。
4. 真實 Playwright E2E 驗證齒輪 SVG 可由滑鼠與鍵盤開啟、深色/高對比即時預覽、取消還原、儲存後重新整理及另一頁面讀回、目前 terminal 字級與監控頻率更新、mobile dialog 無重疊。
5. 執行完整前端、Worker、Go、typecheck、build、check:split 與 LSP；不得重新引入 Browser WASM、`/proxy` 或 secret 回傳。
6. 自動測試與 Playwright 驗證主機卡片／全選自訂核取框的滑鼠與鍵盤行為、主題外觀及無版面位移；驗證 SFTP 檔案與資料夾重新命名 dialog 的預填全選、Enter 確認、Escape 取消與空白阻擋，且瀏覽器原生 prompt 不再出現。

### Worker 穩定性審查補充

1. 使用者要求本輪功能完成後審查 Worker 尚未充分保護的穩定性接縫；本次範圍是提出具體程式碼與平台限制證據，不在未確認修復契約前擴張正式行為。

## 十七、終端剪貼簿、主畫面設定圖示與 Worker 穩定性修復（2026-08-25）

> 觸發：使用者回報「SSH 終端的複製以及貼上功能有問題，還有在主頁面的齒輪圖標沒對齊，順便把剩餘風險修一修」。本節承接第十六節後完成的 Worker 穩定性審查，將原本僅列出的七項風險正式納入修復與驗收。

### 已確認需求與決策

| # | 議題 | 決策 |
|---|------|------|
| D1 | `Ctrl+C` 語意 | 終端有選取文字時，`Ctrl+C`／macOS `Cmd+C` 複製選取內容；沒有選取時不得攔截，必須原樣送給遠端作為中斷訊號 |
| D2 | 跨平台快捷鍵 | Windows/Linux 支援 `Ctrl+Shift+C` 複製、`Ctrl+Shift+V` 與 `Shift+Insert` 貼上；macOS 支援 `Cmd+C`／`Cmd+V`；所有貼上內容透過既有 shell RPC 傳送 |
| D3 | Clipboard 失敗 | Clipboard API 權限被拒或來源不安全時顯示明確錯誤，不吞掉瀏覽器原生事件；仍可使用瀏覽器右鍵／系統原生操作 |
| D4 | 齒輪修正範圍 | 只修連線管理主畫面的齒輪入口；固定 40×40 按鈕、20×20 SVG，以 flex 雙軸置中並與登出按鈕垂直中心一致；工作階段齒輪不改 |
| D5 | RPC frame 上限 | Browser↔DO JSON WebSocket 單一訊息最大約 768 KiB；超限視為 protocol violation 並關閉，不進行 JSON／base64 解碼 |
| D6 | SFTP 大檔 | SFTP 讀寫改為 512 KiB 分塊 RPC；不新增產品層檔案總大小上限，Worker／DO 每次只處理單一有界區塊 |
| D7 | RPC 併發與速率 | 每個 SSH session 最多 4 個 in-flight request；每秒 20 個 request，允許短暫 burst 40；超限明確拒絕並阻止資源繼續擴張 |
| D8 | SSH quota | 同一面板登入 session 最多 3 條 active SSH；全域最多 10 條。quota 以 Durable Object 串行化與具效期 lease 維護，斷線／建立失敗必須釋放 |
| D9 | 批量移動 | 單次 connection bulk move 最多 50 筆；前端與 Worker 都要驗證，超過回明確 400，不建立超大 D1 batch |
| D10 | TOFU timeout | 首次 host-key challenge 最多等待 60 秒；逾時、WebSocket 關閉或 session dispose 都必須 resolve/reject pending verifier 並釋放資源 |
| D11 | TCP 早期讀緩衝 | Go 註冊 `onData` 前的 TCP read buffer 上限 4 MiB；超限關閉 transport 並回安全錯誤，與既有 4 MiB write queue 對稱 |
| D12 | Bootstrap lease | lease 改為 60 秒；長步驟在安全檢查點續租，避免慢速 KDF／KV／D1 工作期間被第二 runner 重複取得；續租失敗立即停止該 owner 後續寫入 |
| D13 | DO 初始化生命週期 | `/init` 產生 10 秒有效的一次性 nonce；`/connect` 必須帶同 nonce，成功後立即清除。過期／錯誤／未 connect 都清除記憶體 config；外層遇一次 409 可重新 init 並重試一次，不持久化 secret |
| D14 | 修復範圍 | 本輪修復全部七項既有穩定性風險，不保留未處理的高／中風險項目 |

### 可觀察行為契約

1. 終端有文字 selection 時複製成功且不把 `Ctrl+C` 傳給遠端；無 selection 時 `Ctrl+C` 仍由 xterm `onData` 送出控制字元。
2. 貼上只把純文字送入目前 ready shell；重連期間沿用既有「不 buffer、不 replay」契約。Clipboard 讀取失敗顯示提示，且不造成空字串或重複貼上。
3. 主畫面齒輪的按鈕與 SVG 在 desktop/mobile 均保持固定盒與中心對齊，不因 SVG path 視覺邊界或相鄰文字按鈕高度位移。
4. 超大 WebSocket message 在 parse/base64 前被拒；RPC request ID、method、params 必須通過結構與大小驗證。in-flight／rate slot 無論成功、失敗或關閉都會釋放。
5. SFTP upload/download 使用連續 offset 與明確 open/read/write/close／abort 流程；每個 chunk 最大 512 KiB，錯誤或斷線會關閉 Go SFTP file handle，不留下後端 handle。
6. SSH quota acquire 為原子判斷；同一 session 第 4 條或全域第 11 條回 429/明確錯誤。連線建立失敗、WebSocket close、explicit disconnect 與 lease expiry 都可回收配額。
7. 超過 50 個 ID 的 bulk move 在查詢 D1 前拒絕；50 筆內維持原本 transaction/count 一致性。
8. TOFU 取消、逾時、socket close 與 dispose 都不留下 pending Promise；host mismatch／auth failure 不觸發自動重連。
9. TCP early read 累積超過 4 MiB 時 transport 關閉；註冊 callback 後依原順序沖刷並歸零 buffered byte count。
10. Bootstrap runner 只允許持有有效 lease 的 owner 更新進度；60 秒 lease 在長步驟檢查點續租，其他頁面只讀進度。
11. DO session config 只在記憶體保存至 10 秒或一次 connect；nonce 不符、過期或重用都拒絕；外層最多重做一次 init，不形成無限重試。

### 驗收條件

1. 每項行為先建立因缺少目標行為而失敗的 RED 測試，再以最小 GREEN 實作；不得弱化既有 SSH、SFTP、D1、TOFU 或重連測試。
2. 前端自動測試覆蓋 clipboard 快捷鍵、selection／SIGINT 分流、paste 失敗與齒輪 DOM/CSS 契約；Playwright 以真實 terminal 驗證複製、貼上與無 selection `Ctrl+C`。
3. Worker／Go 測試覆蓋 frame、rate、in-flight、SFTP chunks／handles、quota acquire/release/expiry、bulk move cap、TOFU timeout/close、TCP read buffer、lease renew 與 nonce lifecycle。
4. 真實 Wrangler + fixture 驗證終端、SFTP 小檔與大於單 chunk 的檔案、quota 拒絕／回收、listener 存活；API／console／logs 不含 credentials。
5. frontend、Worker、Go tests、typecheck、build、check:split 與 LSP 全綠；不得重新引入 Browser WASM、`/proxy` 或 secret API response。
6. 本輪完成後保持既有測試伺服器 `http://127.0.0.1:8787` 運行，除非使用者另行要求停止。
2. 審查至少涵蓋 Durable Object／WebSocket RPC 的訊息大小與並行數、outbound TCP 與 session 數量、D1 批量操作、bootstrap lease，以及 host-key challenge／session config 的生命週期。
3. 報告必須依嚴重度排序，區分現有保護、可重現路徑、平台上限與建議修復順序；不得把尚未加入測試與實作的建議宣稱為已修復。

## 十八、狀態列虛擬記憶體（Swap）監控（2026-08-25）

> 觸發：使用者要求「在狀態列新增虛擬記憶體的查看」。本節沿用既有 SSH 指令輪詢、Linux／Darwin／BSD 優雅降級與緊湊型狀態列契約。

### 已確認需求與決策

1. 「虛擬記憶體」定義為作業系統的 Swap／交換空間，不使用 RAM+Swap 合計或 process virtual address space。
2. 在終端機下方的緊湊型監控狀態列中，於既有「記憶體」項目後新增獨立「虛擬記憶體」項目；不新增 sparkline 或第 4 張 Chart.js 圖表。
3. 顯示格式為「已用 / 總量」及使用百分比，容量沿用既有二進位單位格式化（B／KiB／MiB／GiB／TiB），百分比保留一位小數。
4. 遠端主機未啟用 Swap、且可確定總量與已用量皆為 0 時，顯示 `0 B / 0 B` 與 `0.0%`；不能取得或無法解析時顯示 `--`，不得混淆為零使用量。
5. Linux 由既有 `free -b` 的 `Swap:` 行取得 total/used；不新增額外 Linux SSH round trip。
6. macOS／Darwin 使用 `sysctl vm.swapusage`；BSD 家族沿用同一指令並允許實作差異優雅降級，無法解析時只讓虛擬記憶體顯示 `--`，不得影響 CPU、實體記憶體、磁碟、負載或網路指標。
7. `Metrics`、解析器、顯示格式與 DOM 必須使用明確的 swap total/used 欄位；null 表示未知，數字 0 表示已知且未啟用／未使用。

### 可觀察行為與驗收條件

1. Linux parser 測試覆蓋非零 Swap、`Swap: 0 0 0` 與缺失／非法 Swap 行；Darwin/BSD parser 測試覆蓋標準 `vm.swapusage`、零值與不支援輸出。
2. `displayMetrics()` 測試證明非零值、零容量及 null 的格式分別正確；零容量的百分比固定為 `0.0%`，未知為 `--`。
3. 狀態列 DOM 新增 `m-swap-used` 與 `m-swap-percent`（或等價穩定 ID），位置緊接實體記憶體之後；desktop 與 390×844 手機不得造成水平溢出、文字重疊或狀態列裁切。
4. MetricsPoller、設定中的 3／5／10／30 秒更新頻率、目前 Backend SSH RPC、monitor charts 與其他指標契約保持不變。
5. 依 RED → GREEN → REFACTOR 完成 parser、display 與 UI 契約；執行完整前端測試、Worker 測試、Go 測試、typecheck、build、check:split、LSP 及真實 Playwright SSH 監控驗證。
6. 完成後保持既有 Wrangler 測試伺服器 `http://127.0.0.1:8787` 運行，並保留既有 SSH fixture `127.0.0.1:2222`。

## 十九、GitHub 公開發布與 Cloudflare 手動一鍵部署（2026-08-25）

> 觸發：使用者要求「推送到github,並且做出可以一鍵部署到cloudflare的全自動workflow」。本節定義公開儲存庫、部署資源、秘密邊界與本輪可驗收範圍。

### 已確認需求與決策

1. 使用目前已驗證的 GitHub 帳號 `s12ryt` 建立公開儲存庫 `s12ryt/worker-ssh`，預設分支為 `main`。
2. 儲存庫加入 MIT License。提交原始碼、測試、scripts、README、GitHub Actions workflow、設定範本與 `agent/` 紀錄；排除 `.dev.vars`、GitHub／Cloudflare secrets、本機 Wrangler/D1/KV 狀態、logs、Playwright 截圖與網路紀錄、`dist/`、`node_modules/`、暫存檔及二進位測試產物。
3. Cloudflare production 只允許 GitHub Actions `workflow_dispatch` 手動觸發，不在 push、pull request、tag 或 release 時自動部署。
4. Production 採單一環境，固定命名：Worker `worker-ssh`、D1 `worker-ssh-db`、KV namespace `worker-ssh-kv`。
5. Workflow 第一次執行時自動查找同名 D1 與 KV；存在則重用，不存在則建立。不得每次建立新資源，不得覆寫或刪除其他同名以外資源。
6. Workflow 以動態產生且不提交的 deployment Wrangler config 注入 D1/KV IDs；repository 內不得提交真實 production resource ID。
7. Production 的 `PANEL_PASSWORD`、`ENCRYPTION_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 由使用者之後手動設定為 GitHub Actions repository secrets。本輪不得讀取、複製或沿用本機 `.dev.vars` 值。
8. Workflow 在任何 Cloudflare API／Wrangler 操作前檢查四個 secrets，缺失時以不含值的明確訊息中止；不得將 token、密碼、加密金鑰、產生的 secrets 或敏感回應寫入 logs、artifact、cache 或 repository。
9. Workflow 完整順序為：checkout → 固定 Node/npm 環境 → `npm ci` → 測試／typecheck／build／split guard → 查找或建立 D1/KV → 產生臨時 deploy config → 透過 Wrangler 寫入 Worker secrets → deploy Worker/assets/DO migrations → 輸出非敏感 deployment summary。
10. Production 不遷移目前本機 D1/KV 連線、資料夾、設定、fixture或憑證；遠端首次登入後由既有 D1 bootstrap 自動建立 schema 與空白資料。
11. 本輪因四個 GitHub repository secrets 尚未設定，只推送並驗證 workflow 結構、部署腳本單元測試、缺少 secrets 的安全失敗路徑及 GitHub repository／Actions 可見性；不得宣稱 production 已部署成功，也不觸發 production workflow。

### 可觀察行為與驗收條件

1. Deployment provisioning 先有 RED 測試覆蓋：同名資源重用、缺少資源建立、重複／模糊資源拒絕、API錯誤安全化、臨時config正確綁定 DB/KV/DO/assets、四個secrets缺失時fail fast。
2. Workflow 只能由 `workflow_dispatch` 觸發，使用最小必要 GitHub permissions，不接受 pull request 的未受信任輸入；所有 shell 使用嚴格錯誤模式，步驟不得持續前景運行。
3. `.gitignore`／秘密掃描證明 `.dev.vars`、`.wrangler/`、local state、logs、screenshots、downloads、`dist/`、`node_modules/` 與臨時deployment config不會被提交；`.dev.vars.example`及可公開設定範本必須保留。
4. README 提供「一鍵部署」章節：四個 repository secrets 名稱、Cloudflare API token 最小權限、Run workflow 操作、首次登入/bootstrap、production URL取得方式、資源命名與故障排查；不得要求把秘密提交到檔案。
5. 初始化 Git 前執行秘密與公開檔案盤點；依功能／測試／部署／文件拆成原子提交，建立公開 GitHub repository 後推送 `main`，驗證遠端檔案、分支、Actions workflow與LICENSE可讀。
6. 完整前端、Worker、Go測試、typecheck、build、check:split、deployment script tests與workflow YAML解析通過；本機 Wrangler `http://127.0.0.1:8787` 與 SSH fixture `127.0.0.1:2222` 保持運行。

## 二十、GitHub Actions npm lockfile 相容性修復（2026-08-25）

> 觸發：使用者提供 `Deploy to Cloudflare` workflow run `32802591933` 的 `npm ci` 失敗紀錄。GitHub Node 22 預設 npm 10 回報 lockfile 缺少 `@cloudflare/workers-types@4.20260702.1`；本機 npm 11.7.0 可正常執行同一份 lockfile。

### 已確認需求與決策

1. 專案與 GitHub Actions 的唯一 npm 工具鏈版本固定為 `11.7.0`；不以 npm 10 重建 lockfile，也不承諾 stock Node 22/npm 10 可直接執行 `npm ci`。
2. `package.json` 必須以標準 `packageManager` 欄位宣告 `npm@11.7.0`，讓開發者與自動化工具能辨識正確版本。
3. GitHub workflow 必須在 `npm ci` 前明確安裝 npm `11.7.0`，並執行版本驗證；不得依賴 GitHub runner 隨 Node 22 附帶的浮動 npm 版本。
4. 修復後只提交並推送 `main`，不得由本輪重新觸發 Cloudflare production workflow；使用者自行決定何時再次按下 **Run workflow**。
5. 不變更任何 Cloudflare 資源、repository secrets、Worker 程式行為、本機 D1/KV 資料或既有 Wrangler／SSH fixture 服務。
6. Worker Vitest 的 `ASSETS` 不得依賴被 `.gitignore` 排除的 `dist/client`。採用已提交的最小 `test/fixtures/assets/index.html` 作測試資產，讓 assets binding 本身不要求前端 build；不得以調換 workflow 的 build/test 順序掩蓋這項測試環境依賴。
7. Worker 模組對 `dist/worker/wasm_exec.js` 與 `ssh.wasm` 的靜態匯入屬正式 Go WASM 建置依賴，二進位仍不得提交。依使用者決策，GitHub workflow 在 `npm ci` 後先執行完整 build／split guard，再執行測試；不新增 `pretest:worker` 自動建置。

### 可觀察行為與驗收條件

1. 先擴充 deployment release contract 建立 RED：要求 `packageManager === "npm@11.7.0"`，workflow 在 `npm ci` 前安裝並驗證 `11.7.0`；缺少任一契約時測試必須因目標行為不存在而失敗。
2. 使用 `npx npm@11.7.0 ci --dry-run` 與實際乾淨 `npm ci` 驗證 lockfile；不得以 `npm install` 取代 CI 的 clean install 證據。
3. 執行 deployment tests、完整前端／Worker／Go測試、typecheck、build 與 check:split；不得宣稱未執行的驗證已通過。
4. 建立原子提交並推送 `main`，確認本機 `HEAD` 與 `origin/main` 一致、工作樹乾淨；GitHub workflow 保持 active，且修復推送不會因 workflow 僅有 `workflow_dispatch` 而自動產生新 run。
5. 本機 Wrangler `http://127.0.0.1:8787` 與 SSH fixture `127.0.0.1:2222` 必須保持運行。
6. Worker 測試設定必須指向已提交的 fixture，並以 HTTP fallback 測試證明 `ASSETS` 可用。隔離 worktree 的真實驗證順序為 `npm ci` → `npm run build`／`npm run check:split` → `npm test`；build 產生 Go WASM，但測試 ASSETS 仍只使用已提交的 fixture。

## 二十一、Cloudflare production 加密信封相容性修復（2026-08-25）

> 觸發：production 部署完成後，初始化可完成且一般設定可保存，但建立根目錄資料夾與 SSH 主機皆回 `database operation failed`。唯讀調查確認 D1、KV、assets、Durable Object 與 Worker deployment 均成功；兩個失敗路徑的共同點是第一次執行 AES-GCM 信封加密。

### 已確認根因、需求與決策

1. 現有 v2 信封使用 PBKDF2-SHA256 `210,000` iterations；Cloudflare production Web Crypto 對單次 PBKDF2 iterations 的限制為 `100,000`，因此正式環境拒絕衍生金鑰。本機較新的 workerd 能通過，造成 local/production 行為落差。
2. 使用者的 `ENCRYPTION_KEY` 為密碼產生器生成的 100 字元隨機字串，符合高熵根金鑰前提；不得讀取、輸出、複製或記錄實際內容。
3. 新寫入改為明確版本 `v3:` 信封，使用 HKDF-SHA256 由高熵 `ENCRYPTION_KEY` 衍生 AES-256-GCM key；採獨立 domain-separated salt／info／AAD，每筆維持獨立 96-bit 隨機 IV。
4. v1 裸信封與 v2 `v2:` 信封的解密程式碼保留，避免破壞可支援舊 PBKDF2 iterations 的既有本機資料；新資料與舊資料重新寫入後一律使用 v3。由於 Cloudflare production 本身拒絕 v1/v2 的 210,000 iterations，正式環境不得宣稱可直接匯入這類舊信封；本次 production D1 為新建且尚無成功建立的 encrypted folder/connection rows。
5. D1 schema、folder／connection 公開 API、credential redaction、bootstrap、settings、Backend SSH、KV 與 Durable Object 契約保持不變。
6. 非預期加密錯誤需分類為不含 secret／stack／原始 crypto message 的安全錯誤碼，不再誤導為純 D1 database failure；正常成功回應不增加敏感診斷資訊。
7. 修復完成後建立原子提交並推送 `main`；依使用者決策，不代為觸發 production workflow，由使用者自行手動重新部署。

### 可觀察行為與驗收條件

1. 先建立 RED 測試：新信封必須為 v3、使用 HKDF 而非 PBKDF2；模擬 production 拒絕 `PBKDF2 iterations > 100,000` 時，建立連線與資料夾所需的加密仍可成功。
2. 測試覆蓋 v3 round-trip、獨立 IV、錯誤金鑰、竄改、非法格式與金鑰快取；另以 fixture 證明 v1/v2 解密分支仍存在且版本辨識正確。
3. D1 store 與 HTTP 整合測試證明 connection `payload_envelope`、folder `name_envelope` 新寫入皆以 `v3:` 開頭，建立簡單根資料夾與 password connection 均成功且公開回應不含 credentials。
4. README／部署文件明確要求 `ENCRYPTION_KEY` 使用密碼管理器或密碼學安全亂數生成的高熵值，不建議人類可讀長句或規律字串。
5. 執行 deployment、frontend、Worker、Go、typecheck、build、check:split 與 LSP；以本機 Wrangler 重現建立根資料夾與 SSH 主機成功，且既有 `http://127.0.0.1:8787` 與 SSH fixture `127.0.0.1:2222` 保持運行。
6. 推送後確認 `HEAD === origin/main`、工作樹乾淨、GitHub Actions workflow 維持手動觸發且沒有由 push 產生新的 production run。
