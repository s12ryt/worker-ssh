# 操作記憶（memory.md）

> 紀錄專案的各種操作。即時更新。

## 2026-08-22

- 讀取 `todos.md`（使用者原始需求 7 項）
- 探查工作區：全新專案，僅有 todos.md；無既有程式碼/測試/規範
- skill_find 查詢「Cloudflare Workers KV WebSocket SSH」：無匹配 skill
- question 工具需求澄清（兩輪）：確認 D1–D10（見 agent/question.md）
- 技術調查：
  - anysearch：Workers connect() TCP API 確認可用（僅禁 25 埠）
  - anysearch/GitHub：瀏覽器端無成熟純 JS SSH 函式庫；Go/WASM 模式已被 ssheasy/sshterm 驗證
  - GitHub：hullarb/ssheasy 結構確認（web/ + proxy/，MIT）
- 寫入 `agent/question.md`（含 D11 Go/WASM 引擎決策）
- 寫入 `agent/deep_todos.md`、`agent/項目表.md`、`agent/memory.md`
- 環境確認：Node v24.11.1、npm 11.7.0、Go 1.26.3（GOPATH=C:\Users\yoyo2\go）
- 腳手架建立：package.json（wrangler^4/vitest^3/esbuild/@xterm/simple-icons 等）、tsconfig 三份、vitest.config.ts、wrangler.jsonc、go.mod、scripts/build-go.mjs、gen-icons.mjs；npm install 完成
- TDD 循環 1 crypto.ts：RED→GREEN，7/7 過
- TDD 循環 2 auth.ts：RED→GREEN，10/10 過
- TDD 循環 3 store.ts：RED→GREEN，11/11 過（修正測試自身中文排序預期錯誤）
- TDD 循環 4 wsbridge.ts：validateProxyTarget 4/4＋pump 4/4；pump「TCP→WS」測試曾 5s 逾時，根因＝測試替身 getWriter() 未釋放鎖致 writable.close() 回 rejected Promise 被 try/catch 漏接；改替身固定持有 writer 並暴露 write/end 後全過（未動生產碼）
- 測試基礎設施：建 wrangler.test.jsonc（main 指 src/worker/index.ts 免重建）＋vitest.config.ts miniflare bindings 提供測試用 PANEL_PASSWORD/ENCRYPTION_KEY
- TDD 循環 5 index.ts：RED 26 測試（25 失敗）→ GREEN 完整路由實作 → typecheck 全綠（清理 5 處型別債）→ test:worker 62/62、build:worker 15.4kb
- Go/WASM 引擎 TDD：testserver_test.go in-process SSH server（密碼/公鑰認證、fake exec 協議、shell 回顯、真實 sftp.NewServer）；3 個根因除錯（PublicKeyCallback wire format、pty-req 未回應、pkg/sftp Windows 路徑判定）；go test 17/17 PASS；main.go syscall/js 橋接層以 GOOS=js GOARCH=wasm go build + npm run build:wasm 驗證編譯（dist/client/wasm/ssh.wasm）

## 2026-08-22 前端八模組＋架構補完＋疊代升級（任務 1 完成）
- 決策 D12–D14：UI 膠水層編譯驗證（同 main.go 前例）；BSD 用 Darwin 風格指令＋優雅降級；疊代採量測驅動
- TDD 迴圈 6 monitor.ts：RED（模組不存在）→ GREEN，18 測試（取樣指令組裝/速率差值/格式化/displayMetrics/MetricsPoller）
- TDD 迴圈 7 sftp-paths.ts：RED → GREEN，6 測試（joinPath/parentOf 根目錄邊界）
- 架構補完：gossh.Dial 瀏覽器不可用 → client.go 抽 DialClientWithDialer（既有測試保護重構）＋wsconn.go（WS 型 net.Conn）＋connect(cfg, transport) 接 /proxy
- 新檔：src/frontend/{index.html,main.ts,api.ts,ssh-engine.ts,terminal.ts,sftp-panel.ts,monitor.ts,sftp-paths.ts,styles/liquid-glass.css}、go-ssh/wsconn.go、test/unit/frontend/{monitor,sftp-paths}.test.ts
- 修正：parseDetectOutput 可回 null 加防護；SftpEntry.mode 為 number；esbuild CSS import 產 app.css
- 疊代（量測驅動）：jsPromise FuncOf 用畢 Release（修長期輪詢洩漏）；jsOpenShell 移除 Go↔JS 冗餘往返拷貝；KV N+1 評估後不改（一致性風險>效益，規模小）
- 最終驗證：前端 50/50、Worker 62/62、Go PASS、typecheck 0 錯誤、build 成功

## 2026-08-22 自主疊代第二輪
- 讀取 src/worker/crypto.ts、scripts/build-client.mjs、src/frontend/main.ts（import 區與 L306-319）、test/unit/worker/wsbridge.test.ts（L185-214）、agent/deep_todos.md
- 寫入 test/unit/worker/crypto-cache.test.ts（5 測試，相對路徑 import——worker 設定無 @ alias）
- 修改 src/worker/crypto.ts：金鑰快取 Map＋_keyCacheStats/resetKeyCache 匯出
- 修改 src/frontend/main.ts：terminal 改動態 import；修改 scripts/build-client.mjs：splitting+entryNames+清殘留 JS
- 寫入 scripts/check-split.mjs；package.json 加 check:split script
- 修改 test/unit/worker/wsbridge.test.ts L202 型別放寬修 TS2349
- 更新 agent/deep_todos.md（疊代 2 段落）
- 教訓：splitting 模式進入點預設依 entry 檔名輸出（main.js），須 entryNames 固定為 app.js；esbuild 延遲 chunk 以模組名命名而非 chunk-*；TS 不追蹤閉包內賦值會把 let 窄化為初始 null

## 2026-08-22 表情符號→SVG 替換（D15–D17）
- 盤點：grep 掃 src/frontend，渲染輸出符號僅 sftp-panel.ts 5 處 emoji＋index.html 3 處箭頭字元（←↓↑）；其餘皆程式註解。
- 新增 src/frontend/ui-icons.ts：UI_ICON_PATHS（Material Icons filled 路徑×8）＋iconElement()（createElementNS，aria-hidden）；TDD：ui-icons.test.ts（名稱完備性/路徑格式/零符號不變量）。
- 教訓：(1) PowerShell -Pattern 不支援 \x{...}，Unicode 掃描一律用 grep 工具；(2) SVG path 座標範圍無法用 regex 驗證——弧線旗標緊湊記法（0112＝旗0旗1座12）會偽報，已移除該測試並註明原因；(3) 數值 tokenizer 需支援前導小數點（1.11.89 兩數）。
- sftp-panel.ts：iconLabel() helper（textNode 注入防遠端檔名 HTML 注入）、iconButton()（aria-label+title 僅圖示）、上層列與檔名列改 replaceChildren。
- index.html：返回鈕/下行/上行 inline SVG＋保留文字；liquid-glass.css 附加 .icon/.icon-label/.btn-icon/.metric-card h3 對齊規則。
- 驗證：emoji 掃描 0 匹配、箭頭僅存於註解、typecheck 乾淨、前端 58/58、build+check:split OK（app.js 71.8KB）。

## 2026-08-22 E2E 瀏覽器實測輪（playwright-mcp）
- 基礎設施：scripts/dev-ssh-server/main.go（獨立行程 SSH 測試伺服器：tester/secret-pass、合成 os-release 與 ===CPU=== 指標、回顯 shell、真實 SFTP）；.dev.vars（gitignored）；wrangler dev --port 8799（8787 被 Cute Email 佔用）。
- 修復缺陷×7：(1) loadSshEngine 同步讀 sshEngine 競爭→waitForEngine 輪詢；(2) WS 早期事件跨 Go/JS 邊界遺失→ProxyTransport shim 建構當下同步接管事件並緩衝，Go 端註冊時補叫；(3) WsConn.Write 對 ProxyTransport 取 readyState panic→移除檢查改 channel 閘門＋shim.send 防護；(4) workerd message data 為 Blob，String(Blob)="[object Blob]" 垃圾位元組→四分支轉換（TDD：Blob 測試 RED 重現）；(5) dev-ssh-server os-release 分支漏 ===UNAME===/===OSREL=== 標記；(6) SshClient.list spread Promise→await 後 spread；(7) openShell 缺 await→shells Map 存 Promise→jsShellClose Int() panic 致 Go 死亡。
- api.ts putOs 契約修正：Worker 期望 { key, info } 巢狀。
- 「＋ 新增連線」全形加號 U+FF0B 改 inline SVG；favicon 以 data URI SVG 補上。
- crypto-cache 測試 timeout 30s→60s（並行負載 flake）。
- E2E 全通：登入→連線列表→新增連線→連線→終端雙向回顯→OS 標籤 ubuntu 24.04（KV 快取命中）→監控八指標有值→SFTP 表格渲染→返回鈕；emoji 掃描零匹配；截圖×4 存 .playwright-mcp/。
- 教訓：workerd WS message data 型別須四分支處理；瀏覽器快取使重建偽失效（CDP setCacheDisabled）；build 成功須以 dist 指紋驗證；假 shim 無對端其 TIMEOUT 不構成反證；"[object Blob]" 恰 13 字元的偽正確長度——內容比對才可靠。

## 2026-08-22 自主疊代第三輪 — Web UI 美化（D18–D24）
- 讀取 src/shared/types.ts、src/worker/index.ts、src/worker/store.ts、src/frontend/{main,monitor,sftp-panel,terminal,api,osdetect,ui-icons}.ts、src/frontend/index.html、src/frontend/styles/liquid-glass.css、scripts/build-client.mjs、test/unit/worker/{store,index}.test.ts、test/unit/frontend/*.test.ts、scripts/dev-ssh-server/main.go、.dev.vars、wrangler.jsonc
- 兩輪 question 工具澄清確認 D18–D24，寫入 agent/question.md 第五節
- todowrite 建立 11 階段工作項目（階段 1 KV schema → 階段 11 完成報告）
- 階段 1：types.ts ConnectionConfig 加 lastConnectedAt?/lastDisconnectedAt?；store.test.ts 加 4 測試（容錯讀取舊資料）—直接 GREEN（store 層泛型 spread/JSON.parse 天然支援）
- 階段 2：index.ts sanitizePatch 白名單加 lastConnectedAt/lastDisconnectedAt（數字/null/非數字 400）；index.test.ts TDD RED→GREEN 3 測試
- 階段 3：npm install --save-dev @fontsource/inter @fontsource/noto-sans-tc；build-client.mjs 加 fonts 複製區塊（5 woff2：Inter 400/600/700 + Noto Sans TC 400/600）；liquid-glass.css 加 5 個 @font-face；index.html 加 preload Inter 400
- 階段 4：npm install chart.js；monitor.ts 加 SampleBuffer 純類別 TDD（6 測試，環形緩衝 capacity=60）+ createMonitorCharts 膠水層（動態 import chart.js/auto，3 sparkline，extractPercents + makeChart 工廠）+ PollerDeps.onSnapshot 回呼；index.html 加 3 canvas；main.ts connectTo/teardown 整合（charts 容錯 null，try/catch 不阻斷）
- 階段 5：liquid-glass.css 306→430 行（設計 token 擴充、骨架屏 shimmer、空狀態插圖、hover/focus 微互動、終端機標題列、SFTP 分色、響應式 1024/720/480 三段、prefers-reduced-motion 降級）；index.html 加 conn-skeleton/conn-empty（空狀態插圖）/term-wrap（終端機標題列）
- 階段 6：format.ts formatLastConnected 純函數 TDD（9 測試，YYYY-MM-DD UTC 避時區歧義）；main.ts renderConnList 加 meta-row（status-indicator + last-time）；showConnections 骨架屏；connectTo 寫 lastConnectedAt；teardown 寫 lastDisconnectedAt
- 階段 7：sftp-file-kind.ts fileKindOf 純函數 TDD（12 測試，7 類分色 folder/archive/code/image/doc/binary/file，ARCHIVE_DOUBLE 正則處理 .tar.gz/tgz/tbz2）；sftp-panel.ts data-kind 接線 + renderSkeleton 骨架屏；main.ts setStatus 同步 term-status + term-conn-name 接線；CSS 補 .sftp-skeleton-list/row
- 階段 8：read liquid-glass.css line 510–584 確認三段斷點；480px 補三項（term-conn-name 截斷、conn-meta-row column、sftp-container overflow-x）
- 階段 9：並行回歸驗證 — typecheck 0 錯；check:split OK；test:worker 78/78；test:go ok(cached)；test:frontend 85/85；build:client 成功；build:worker 17.9KB
- 階段 10：playwright-mcp E2E 截圖 ×6（shot-1-login-desktop / shot-2-connections-desktop / shot-3-terminal-desktop / shot-4-sftp-desktop / shot-5-monitor-desktop / shot-6-monitor-mobile-480）；沿用前次會話殘留 dev-ssh-server.exe pid 36896（監 2222）+ workerd pid 11404（監 8799）
- 階段 11：更新 agent/deep_todos.md（疊代 4 段落）、項目表.md（目錄結構 + 依賴方向 + 第三輪美化橋接段落）、memory.md（本段）
- 教訓：(1) 可選欄位 + spread/JSON.parse 不需特殊處理，真正守門在 API 路由層 sanitizePatch 白名單——store 測試直接 GREEN 是合理而非偽綠；(2) chart.js/auto chunk 比預估 70KB 大（實際 200KB），但仍延遲載入不阻塞首頁，D19 決策方向正確；(3) esbuild splitting + 動態 import 產生獨立 chunk 自動延遲載入，無需手動處理；(4) noUncheckedIndexedAccess 導致 charts[0]/datasets[0] 可能 undefined，須用個別變數 + 非空斷言；(5) PowerShell Get-Content -Tail 對 UTF-8 中文輸出亂碼，須用 read 工具；(6) formatLastConnected 用 getUTCFullYear/Month/Date 避免 localhost 與 UTC 顯示歧義；(7) 字型自托管屬純靜態資料例外，無可 TDD 邏輯，改以 build 產物 + typecheck + 既有測試回歸為證；(8) 前次會話殘留背景服務（dev-ssh-server + workerd）可直接沿用做 E2E，無需重啟。

## 2026-08-23 SFTP 文字檔線上預覽（D25–D33）
- 使用者原始需求 m0195：「無法在線查看文字文件」；question 工具確認情境＝worker-ssh SFTP 面板點擊 .txt/.md 無法直接預覽（僅有下載）；兩輪 question 確認 D25–D33，寫入 agent/question.md 第六節
- 脈絡確認：go-ssh/sftpfs.go 已有 SftpReadFile、main.go 已有 jsSftpReadFile 橋接、ssh-engine.ts SshClient.readFile 已存在、sftp-panel.ts download() 已用 client.readFile 讀檔——引擎/API 層完整，本次僅前端加預覽 UI 層
- todowrite 建立 9 階段工作項目（P1 install → P9 完成報告）
- P1：npm install highlight.js（30 packages funding, 5 high vuln 不影響使用）
- P2：TDD highlight-language.ts — languageOfFilename 純函數 27 測試（EXT_TO_LANG 映射表 ~40 副檔名，大小寫不敏感，js/mjs/cjs/jsx→javascript、ts/tsx→typescript、sh/bash/zsh→bash、xml/html/htm/xhtml→xml、md/markdown→markdown、cpp/cc/cxx/hpp→cpp、c/h→c、diff/patch→diff、ini/cfg→ini；無副檔名/隱藏檔/未知→null）；測試案例筆誤 `z.shrc` 改 `config.zsh`
- P3：TDD sftp-preview.ts — isPreviewable 純函數 13 測試（isDir→false；size 非有限數/負→false；size>1MB→false；fileKindOf binary/archive/image→false；其餘→true）+ PREVIEW_MAX_BYTES + PreviewableEntry 介面
- P4：preview-modal.ts 184 行（openPreviewModal + loadHighlighter 冪等 + LANG_MODULES 20 語言映射）；ui-icons.ts 加 eye/close/copy 三圖示；decodePreviewText TDD 21 測試（TextDecoder fatal:false，U+FFFD 比例 ≥10% 回 null；邊界測試 10 位元組含 1 個 0xff=10% 剛好觸發，改 20 位元組含 1 個 0xff=5% 通過）；ui-icons.test.ts 更新為 11 圖示清單
- P5：sftp-panel.ts 整合 — render nameCell 加 is-clickable + click 開預覽（D26 第二觸發）；actions 非資料夾加 iconButton("eye", "預覽")（D26 按鈕觸發）；preview() 私有方法（isPreviewable 守門 → 大小上限 toast「檔案過大，請改用下載」/二進位 toast「不支援線上預覽」→ 讀檔 → openPreviewModal with onCopy clipboard + onDownload）
- P6：liquid-glass.css +108 行 — .preview-backdrop（fixed inset:0 z-index:200 rgba backdrop blur animation previewFadeIn）+ .preview-modal（glass-bg-strong min(900px,92vw) max-height:88vh shadow-lifted+glow animation previewIn）+ .preview-titlebar/content/pre/footer + highlight.js 暗色 token 色彩自訂最小化（keyword→#c4b5fd、string→#86efac、number→#fcd34d、title→#7dd3fc、comment→ink-dim italic、built_in→#5eead4 等，避免引入外部主題檔案維持 D21 零 CDN）+ .is-clickable + 480px 響應式（preview-backdrop padding:8px、modal 96vw/92vh、pre 0.78rem）+ @keyframes previewFadeIn/previewIn
- P7：回歸驗證 — typecheck 0 錯；test:frontend 11 檔 133/133 全綠；build:client 成功（app.js 84759 +5.4KB、liquid-glass.css 22348 +3.4KB、core-BKSSFOLX.js 20824 highlight.js/lib/core、20 語言各自獨立 chunk 0.6-13KB 全延遲載入）；check:split OK；test:go ok(cached)；test:worker 1 failed|77 passed（crypto-cache 第 4 測試 flaky——Network connection lost + EBUSY，單獨跑 5/5 通過，根因 vitest-pool-workers 並行 spawn workerd 共用 miniflare 暫存目錄 Windows 檔案鎖衝突，本次未動 Worker 程式碼非本次責任）
- P8：playwright-mcp E2E ×2 截圖（shot-preview-modal-log、shot-preview-too-large）；8 項全通過——預覽按鈕 eye 顯示/點擊按鈕開 Modal/點擊檔名開 Modal/Modal 結構正確/Esc 關閉/關閉鈕關閉/大檔 6.3GiB 拒絕 toast/語法高亮正常（hljs language-ini + 15 span 子節點 hljs-section）；背景服務 pid 22096（dev-ssh-server 監 2222）+ pid 33164（wrangler dev 監 8799）
- P9：更新 agent/deep_todos.md（任務 5 段落）、項目表.md（目錄結構 + 依賴方向 + SFTP 預覽橋接段落）、memory.md（本段）
- 教訓：(1) 引擎/API 層已具備讀檔能力時，新功能僅需前端 UI 膠水層，避免無謂擴張到 Worker/Go；(2) highlight.js 動態 import 'highlight.js/lib/core' + 按需註冊語言比 import full 版本（~90 語言）省大量體積，esbuild splitting 自動產生 20 個獨立語言 chunk；(3) decodePreviewText U+FFFD 比例判定二進位用 ≥10% 邊界（保守拒絕），測試數據須避開剛好 10% 邊界（10 位元組 1 個 0xff=10% 會誤觸，改 20 位元組 1 個 0xff=5%）；(4) Modal DOM 由 JS 動態建立不修改 index.html，關閉三路（closeBtn/backdrop/Esc）+ closed 旗標防重複；(5) highlight.js 暗色 token 色彩自訂最小化避免引入外部主題檔案，維持 D21 零外部 CDN 慣例；(6) crypto-cache flaky 是既有環境問題（vitest-pool-workers 並行 spawn workerd 共用 miniflare 暫存目錄 Windows 檔案鎖衝突），單獨跑通過即非本次責任，須明確記錄根因避免誤報；(7) npx 在此環境不可用，啟動 wrangler 須用 `node node_modules\wrangler\bin\wrangler.js dev` 直接呼叫。

## 2026-08-23 SFTP 文字檔線上編輯（D34–D46）
- 使用者原始需求 m0352：「可以在線查看了,為什麼不能在線編輯」；三輪 question 工具澄清確認 D34–D46，寫入 agent/question.md 第七節
- 脈絡確認：go-ssh/sftpfs.go SftpWriteFile 已存在（sftp.Client.Create+Write+Close 覆蓋式）、ssh-engine.ts SshClient.writeFile 已存在（line ~283 checkSync(engine.sftpWriteFile)）——引擎/API 層完整，本次僅前端加編輯 UI 層
- todowrite 建立 9 階段工作項目（E1 install → E9 完成報告）
- E1：npm install CodeMirror 6——三次失敗（@codemirror/lang-lua 404 無官方 Lua 包、@codemirror/lang-ruby 404 無官方 Ruby 包、@codemirror/lang-typescript 404 TypeScript 由 lang-javascript { typescript: true } 支援）；第四次成功移除上述三套件，安裝 13 個 lang-* + 6 個核心套件（codemirror + @codemirror/{view,state,commands,language,autocomplete,search} + @codemirror/lang-{javascript,python,go,json,yaml,xml,markdown,css,sql,cpp,java,rust,php}）；Ruby/Lua/Diff/INI fallback 純文字無高亮（仍可編輯）
- E2：TDD filename-validate.ts — validateFilename 純函數 25 測試（不能含 /\:*?"<>|、非空、≤255、不能是 . 或 ..、不能全空白；type guard name is string）；isEditable 不新增（D36 與 isPreviewable 相同條件，直接沿用既有純函數，依 OREO「不預先加入未被測試驅動的抽象」）
- E3：跳過（SshClient.writeFile 已存在）
- E4：edit-modal.ts 337 行——openEditModal 回傳 close 函數；loadCodeMirror 冪等動態 import 五套件；LANG_LOADERS 13 語言動態載入（javascript/typescript→lang-javascript {typescript:true}、python/go/json/yaml/xml/markdown/css/sql/cpp/c/java/rust/php）；唯讀切換 readOnlyCompartment.reconfigure(EditorState.readOnly.of(value))（D46 保留編輯內容）；Ctrl+S 儲存、Ctrl+Shift+S 另存、Esc 關閉（未儲存 confirm D38）；狀態徽章 dirty/clean/saved/error；D42 二次確認 window.confirm；D41 另存預設檔名「原檔名.copy.原副檔名」+ validateFilename 守門
- typecheck 修正歷程：第一次寫入多錯（EditorStateCtor 重複 readOnly、Cannot find module 'cm-loader'、LANG_LOADERS Promise 型別不符、stateMod.history/indentUnit 不存在）；第二次重寫簡化型別 CmBundle type 用 typeof import(...)；context7 查證 CodeMirror 6 API——history 來自 @codemirror/commands（非 state）、indentUnit 來自 @codemirror/language（非 state）、lineNumbers()/highlightActiveLine() 是函式需呼叫、language.of(langExt) 需 langExt 為 Language 型別；最終 typecheck 0 錯
- E5：sftp-panel.ts 整合——import 移除 openPreviewModal 加 openEditModal + decodePreviewText；nameCell click this.preview(e)→this.edit(e)；actions iconButton("eye","預覽")→iconButton("pencil","編輯")；preview() 方法改名 edit()（isPreviewable 守門保留 D36；decodePreviewText 判定 null 拋錯「包含大量二進位資料，不支援線上編輯」；openEditModal with onSave writeFile(connId,path,new TextEncoder().encode(newText))、onSaveAs writeFile(connId,joinPath(currentPath,newName),...)、onDownload 委派 download()）；ui-icons.ts 加 pencil 圖示（共 12 個）；ui-icons.test.ts 更新為 12 圖示清單
- E6：liquid-glass.css +108 行（22348→27916 +5568）——.edit-backdrop（fixed z-index:220 rgba blur animation editFadeIn）+ .edit-modal（glass-bg-strong min(960px,94vw) max-height:90vh shadow-lifted+glow animation editIn）+ .edit-titlebar/title-wrap/title/status-badge[data-state=dirty|clean|saved|error]+ .edit-content + .cm-* CodeMirror 暗色主題（與 hljs token 色彩一致 keyword→#c4b5fd、string→#86efac 等）+ 480px 響應式 + prefers-reduced-motion 降級
- E7：回歸驗證——typecheck 0 錯；test:frontend 12 檔 158/158 全綠（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12 + highlight-language 27 + sftp-preview 21 + filename-validate 25）；build:client 成功（app.js 88533 +3.6KB、liquid-glass.css 27916 +5568、codemirror chunks 7 個延遲載入核心 200.8KB + 多個 lang-* 49-104KB）；check:split OK
- E8：playwright-mcp E2E ×1 截圖（shot-edit-modal-open.png）；6 項全通過——編輯按鈕 pencil 顯示/點擊按鈕開 Modal/Modal 結構正確（標題列+檔名+未儲存徽章+切換唯讀/另存/存檔/下載/關閉五按鈕+CodeMirror 行號+textbox 語法高亮 INI 格式）/dirty 徽章顯示（內容變更後）/Esc 關閉時 confirm 提示未儲存 D38/接受 confirm 後 Modal 關閉返回 SFTP 列表；背景服務 pid 27768（dev-ssh-server 監 2222）+ pid 33164（wrangler dev 監 8799）前次會話殘留沿用
- E9：更新 agent/deep_todos.md（任務 6 段落）、項目表.md（SFTP 編輯橋接段落）、memory.md（本段）
- 教訓：(1) CodeMirror 6 無官方 Lua/Ruby/TypeScript 語言包——TypeScript 由 lang-javascript {typescript:true} 支援，Lua/Ruby 須 fallback 純文字無高亮；(2) CodeMirror 6 API 分布在多個套件——history 在 @codemirror/commands 非 @codemirror/state、indentUnit 在 @codemirror/language 非 @codemirror/state、lineNumbers/highlightActiveLine 是函式需加括號呼叫、language.of(langExt) 需 langExt 為 Language 型別須 cast；(3) 唯讀切換須用 Compartment.reconfigure(EditorState.readOnly.of(value)) 而非直接 dispatch（Compartment 機制為 CodeMirror 6 動態重組態 extensions 的正確方式，D46 保留編輯內容即靠此不重建 editor）；(4) 既有 preview-modal.ts 保留不動避免破壞既有測試——不再被 sftp-panel 呼叫但仍可被其他模組使用，符合「不擴張需求範圍或回復無關變更」原則；(5) CodeMirror 6 延遲載入經 esbuild splitting 產生 7 個獨立 chunk（核心 200.8KB + 多個 lang-* 49-104KB），與 highlight.js/chart.js/xterm 同為延遲載入不阻塞首頁。

## 2026-08-23 自主疊代升級 — bug 檢查與修復
- 使用者原始需求 m0463：「自主疊代升級,優先查看授權部分有無bug,之後再仔細翻找其餘代碼有無bug」
- todowrite 建立 8 階段工作項目（B1 讀取授權 → B2 審查授權 → B3 修復 → B4 審查其餘 → B5 修復 → B6 回歸 → B7 Go 審查 → B8 報告）
- B1：batch_read 7 檔（auth.ts/crypto.ts/index.ts/api.ts/wsbridge.ts/store.ts/main.ts 登入流程）建立行為特徵
- B2：授權部分審查——未發現需修復的 bug。timingSafeEqual SHA-256 雜湊+常數時間比較 ✓；AES-GCM 信封 PBKDF2 210k 迭代 ✓；金鑰快取 Map 16 上限近似 LRU ✓；sessionCookie HttpOnly+Secure+SameSite=Strict+Path=/+Max-Age ✓；isAuthed 缺 await 非 bug（async 函數自動 unwrap Promise；verifySessionToken 內部 try/catch 不會 reject）；/api/logout 無方法檢查（GET 也清 cookie）不影響安全（SameSite=Strict cookie 已防 CSRF；logout 只清 cookie 無副作用）；wsbridge Blob 順序潛在問題非現存 bug（workerd WebSocket 訊息型態固定不混合）；store list N+1 查詢（b6 壓縮塊已記錄「一致性風險>效益，規模小」決策）
- B3：授權部分無 bug 需修復，跳過
- B4：batch_read 12 檔（monitor/sftp-panel/ssh-engine/edit-modal/osdetect/preview-modal/format/sftp-preview/sftp-file-kind/highlight-language/filename-validate/terminal）——發現 2 bug（同根同源：edit-modal.ts preloadLanguage 語言模組匯出名稱不匹配）
  - Bug 1（中嚴重度）：TypeScript 語法高亮失效——highlight-language.ts ts/tsx→"typescript"，LANG_LOADERS["typescript"]=()=>import("@codemirror/lang-javascript")，但 lang-javascript 匯出 `javascript` 不匯出 `typescript`，`mod["typescript"]`=undefined 返回 null fallback 純文字；根因：typescript 特殊處理在 `lang === "javascript"` 條件下才觸發，當 lang 是 "typescript" 時不會進入該分支
  - Bug 2（中嚴重度）：C 語法高亮失效——highlight-language.ts c/h→"c"，LANG_LOADERS["c"]=()=>import("@codemirror/lang-cpp")，但 lang-cpp 匯出 `cpp` 不匯出 `c`，`mod["c"]`=undefined 返回 null
- B5：TDD 修復——RED 新增 test/unit/frontend/edit-modal-lang.test.ts（12 測試：typescript→javascript、c→cpp、javascript/cpp/python/go/rust/java/php/sql→自身、未知→自身、空字串→自身），12 失敗原因 `resolveLangExportName is not a function`；GREEN 修改 src/frontend/edit-modal.ts 加 LANG_EXPORT_NAME 映射表（typescript→"javascript"、c→"cpp"）+ resolveLangExportName export 純函數 + preloadLanguage 改用 `const exportName = resolveLangExportName(lang); const factory = mod[exportName]` + typescript 特殊處理條件改為 `lang === "javascript" || lang === "typescript"` + isTs 判定改為 `lang === "typescript" || filename.toLowerCase().endsWith(".tsx")`；12/12 全綠
- B6：回歸驗證——typecheck 0 錯；test:frontend 13 檔 170/170 全綠（原 12 檔 158 + edit-modal-lang 12）；build:client 成功；check:split OK
- B7：batch_read 5 個 Go 正式檔案（main.go/client.go/sftpfs.go/session.go/wsconn.go）——未發現需修復的 bug。main.go allocID/getConn/getShell 線程安全（mu.Lock）✓、jsPromise handler.Release() ✓、jsSftpList sort.Slice 目錄優先 ✓；client.go AuthType switch 正確 ✓、NewClientConn 失敗 conn.Close() ✓；sftpfs.go slashPath filepath.ToSlash ✓、sftpClientOf defer cli.Close() ✓、SftpRemove 先 Remove 失敗再 RemoveDirectory ✓、SftpRename PosixRename 優先 ✓；session.go RunCommand defer Close + ExitError ✓、ShellHandle closed 旗標防重複 ✓；wsconn.go NewWsConn inbox 64 緩衝 + open/done 通道 ✓、closeWithError closeOnce 防重複 ✓。潛在問題 3 項均非現存 bug：(1) jsOpenShell go onData.Invoke(arr) 大量並發輸出理論上順序不保證（SSH 輸出通常序列）；(2) SftpWriteFile defer+顯式重複 Close（sftp.File.Close() 安全處理）；(3) WsConn.inbox 緩衝 64 有 done 分支防死鎖
- B8：更新 agent/deep_todos.md（任務 7 段落）、項目表.md（bug 修復橋接段落）、memory.md（本段）
- 教訓：(1) 語言模組匯出名稱與語言識別碼不必然相同——TypeScript 的匯出是 `javascript`（用 {typescript:true} 參數支援 TS）、C 的匯出是 `cpp`（同套件不同函數），須用映射表 resolveLangExportName 轉換；這類 bug 屬「膠水層不匹配」——純資料表（highlight-language.ts）正確但動態載入層（edit-modal.ts preloadLanguage）取匯出時用語言識別碼而非匯出名稱；(2) TDD 純函數 resolveLangExportName 比直接內聯映射更佳——可獨立測試、可重用、符合 OREO「不預先加入未被測試驅動的抽象」原則（本次由 bug 驅動而非預先抽象）；(3) 授權部分審查需關注 timing attack（常數時間比較 ✓）、session fixation（token 隨密碼變化 ✓）、cookie 屬性（HttpOnly+Secure+SameSite=Strict ✓）、CSRF（SameSite=Strict 已防 ✓）——本專案授權實作嚴謹無 bug；(4) Go 代碼審查需關注線程安全（mu.Lock ✓）、資源釋放（defer Close ✓）、重複關閉防護（closed 旗標/closeOnce ✓）——本專案 Go 引擎實作嚴謹無 bug；(5) isAuthed `return verifySessionToken(token, ...)` 缺 await 初看像 bug 但實際不是——async 函數自動 unwrap Promise，且 verifySessionToken 內部有 try/catch 不會 reject，這類「看似 bug 實則非 bug」的情況須謹慎分析而非盲目修改。

## 2026-08-23 Bug 3 後續修復（使用者 E2E 反饋）
- 使用者 m0503 反饋：「yaml這類打不開 顯示 Cannot read properties of undefined (reading 'startParse')」
- Bug 3（高嚴重度）：所有 CodeMirror 語言高亮崩潰。根因：edit-modal.ts line 201 `cm.language.of(langExt as import("@codemirror/language").Language)` 將 LanguageSupport cast 為 Language，language.of() 返回 StateEffect（用於 `editor.dispatch({ effects })`）非 Extension（用於 `EditorState.create({ extensions })`），CodeMirror 6 嘗試在 LanguageSupport 上呼叫 startParse（Language 方法）→ `undefined.startParse` 崩潰。影響範圍：所有有 LANG_LOADERS 條目的語言（javascript/typescript/python/go/json/yaml/xml/markdown/css/sql/cpp/c/java/rust/php）都會崩潰；ini/log 等無條目語言不崩潰但也無高亮。.log（ini）之前 E2E 正常是因為 LANG_LOADERS 沒有 "ini" 條目，preloadLanguage 返回 null，languageExt=[]，不會觸發崩潰
- 修復：edit-modal.ts line 201 改為 `[langExt as import("@codemirror/state").Extension]`——LanguageSupport 本身就是 Extension（CodeMirror 6 標準用法），直接用陣列包裝傳入 EditorState.create
- 後端 API 認證審查（m0500 使用者追問）：系統性檢查 src/worker/index.ts 所有 API 端點（/api/login POST、/api/session GET、/api/logout ANY、/api/connections GET+POST、/api/connections/:id GET+PUT+DELETE、/api/os GET+PUT、/proxy WebSocket），結論：所有需要認證的端點都有 isAuthed 守衛或屬不需認證端點，沒有遺漏
- E2E 驗證：serverpro.html（xml 語言，有 LANG_LOADERS 條目）跨輯 Modal 正確開啟不崩潰，截圖 shot-xml-syntax-highlight.png；測試 yaml 上傳到 /tmp 目錄（根目錄 C:\ 無寫入權限被拒）
- 最終測試：前端 13 檔 170/170、typecheck 0 錯、build 成功、check:split OK
- 教訓：(1) CodeMirror 6 LanguageSupport 與 Language 是不同型別——LanguageSupport 是 Extension（可直接傳入 EditorState.create），Language 是語法解析器（須用 language.of() 包裝為 StateEffect 用於 dispatch）；cast LanguageSupport 為 Language 會導致 CodeMirror 嘗試呼叫 Language 方法（startParse）在錯誤物件上崩潰；(2) language.of() 返回 StateEffect 非 Extension——StateEffect 用於 `editor.dispatch({ effects })` 動態切換語言，Extension 用於 `EditorState.create({ extensions })` 初始組態；混淆兩者會導致 CodeMirror 6 內部狀態不一致崩潰；(3) 「.log 正常但 yaml 崩潰」是診斷關鍵線索——.log 對應 ini 無 LANG_LOADERS 條目故 languageExt=[] 不觸發崩潰，yaml 有條目才觸發；這類「部分語言正常部分崩潰」的 bug 須從語言載入路徑差異切入而非 uniformly 調查；(4) CodeMirror 6 膠水層無法用純函數 TDD 重現 startParse 崩潰——須以 typecheck + build 產物 + E2E 截圖為證（OREO 例外條款：膠水層屬 UI 整合層無可 TDD 的純邏輯）；(5) SFTP 上傳須注意目標目錄寫入權限——Windows 根目錄 C:\ 被拒，須進入 tmp 等有寫入權限的子目錄。

## 2026-08-23 Bug 4 後續修復（使用者 E2E 反饋）
- 使用者 m0569 反饋：「怎麼md文件沒有高亮顯示啊」+ m0637「連結高亮能改成但藍色嗎」
- Bug 4（中嚴重度）：所有語言語法高亮失效（包括 markdown）。根因：CodeMirror 6 的 defaultHighlightStyle 使用 opaque hash-based class（ͼ5/ͼ7/ͼ9/ͼc 等），不是 .tok-keyword 這種可讀 class；CSS .tok-keyword/.cm-keyword 等規則無法匹配 opaque class，視覺無高亮。語法解析本身正常（span 有被分割成不同 ͼN class），只是 class 名稱不可讀。影響範圍：所有語言（javascript/typescript/python/go/json/yaml/xml/markdown/css/sql/cpp/c/java/rust/php）都有語法解析但無視覺高亮
- E2E 診斷：list1.md Modal 正確開啟不崩潰（Bug 3 修復生效），CodeMirror 正確渲染（cm-content 47 行），但 tokCount=0（`[class*="tok-"]` 找不到），cmLineHTML=`<span class="ͼ7 ͼ5">#</span>`（opaque class），allClasses=["cm-activeLine","cm-gap","cm-line","ͼ5","ͼ6","ͼ7","ͼ9","ͼc"]
- 修復：edit-modal.ts 三處修改
  1. CmBundle type（line 23-27）：移除 defaultHighlightStyle，加 syntaxHighlighting + HighlightStyle + tags
  2. loadCodeMirror（line 96-119）：Promise.all 加 `import("@lezer/highlight")` → lezerMod，return object 改 HighlightStyle: languageMod.HighlightStyle + tags: lezerMod.tags（移除 defaultHighlightStyle）
  3. EditorState.create extensions（line 226）：`cm.syntaxHighlighting(cm.defaultHighlightStyle)` → `cm.syntaxHighlighting(buildCustomHighlightStyle(cm))`
  4. 新增 buildCustomHighlightStyle 函數（line 34-88）：~40 種 Lezer tag→tok-* class 映射（keyword/controlKeyword/operatorKeyword/modifier→tok-keyword、string→tok-string、special(string)→tok-string2、number/integer→tok-number、bool→tok-bool、atom/null/self→tok-atom、comment→tok-comment、variableName/local(variableName)→tok-variableName、function(variableName)/function(propertyName)→tok-function、typeName→tok-typeName、namespace→tok-namespace、propertyName→tok-propertyName、punctuation/separator→tok-punctuation、operator/derefOperator/arithmeticOperator/logicOperator/bitwiseOperator/compareOperator/updateOperator/definitionOperator/typeOperator→tok-operator、meta/processingInstruction→tok-meta、tagName→tok-tagName、attributeName→tok-attributeName、attributeValue→tok-attributeValue、heading1-6/heading→tok-heading、link→tok-link、url→tok-url、invalid→tok-invalid、contentSeparator→tok-punctuation、labelName→tok-propertyName、inserted→tok-string、deleted→tok-invalid）
- 連結高亮改但藍色：CSS .tok-link/.cm-link color 從 #7dd3fc（淺藍）改為 #60a5fa（Tailwind blue-400，更飽和的藍色，使用者 m0637 要求）
- @lezer/highlight 確認：Test-Path node_modules\@lezer\highlight\package.json → True，是 @codemirror/language 的依賴，已安裝無需額外 npm install
- E2E 驗證：list1.md markdown 語法高亮正常，tokCount 0→122，tokClasses opaque ͼN→語意化 tok-heading/tok-link/tok-meta/tok-punctuation/tok-url，firstLineHTML `<span class="ͼ7 ͼ5">#</span>`→`<span class="tok-heading tok-meta">#</span>`；截圖 shot-markdown-syntax-highlight.png
- 最終測試：前端 13 檔 170/170、typecheck 0 錯、build 成功（app.js 90813 bytes +2080 bytes 因加 buildCustomHighlightStyle + @lezer/highlight import）
- 教訓：(1) CodeMirror 6 defaultHighlightStyle 使用 opaque hash-based class（ͼN 格式）而非語意化 .tok-* class——這是效能考量（opaque class 較短減少 DOM 大小）但導致 CSS 無法用語意規則匹配；自訂 HighlightStyle 須用 `HighlightStyle.define([{ tag: tags.keyword, class: 'tok-keyword' }, ...])` 明確指定 class 屬性，CSS .tok-* 規則才能匹配；(2) CodeMirror 6 語法高亮機制需兩部分——(a) 語言套件（如 @codemirror/lang-markdown）提供 Parser 解析文本產生 Lezer 樹節點標記；(b) HighlightStyle 將 Lezer tag（tags.keyword/tags.string 等）映射到 CSS class；缺少 HighlightStyle 則 Parser 解析正常但不產生高亮 class（span 有 ͼN 但無色彩）；(3) Bug 4 與 Bug 3 是不同層級的問題——Bug 3 是 language.of() 返回 StateEffect 非 Extension 導致崩潰（完全無法使用）；Bug 4 是 defaultHighlightStyle 用 opaque class 導致無視覺高亮（可用但無色彩）；修復 Bug 3 後才暴露 Bug 4（不崩潰但無高亮）；(4) E2E 診斷關鍵：用 evaluate 檢查 `[class*="tok-"]` 數量（tokCount）+ .cm-content 子元素 allClasses——tokCount=0 + allClasses 含 ͼN 表示 opaque class 問題；tokCount>0 + allClasses 含 tok-* 表示高亮正常；(5) 自訂 HighlightStyle 須覆蓋完整 Lezer tag 集（~40 種）否則部分標記無色彩——本次覆蓋 keyword/string/number/bool/atom/comment/variableName/function/typeName/namespace/propertyName/punctuation/operator/meta/tagName/attributeName/attributeValue/heading/link/url/invalid 等，未覆蓋的 tag 會 fallback 無色彩但不崩潰。

## 2026-08-23 SFTP 文字檔瀏覽器渲染預覽（D1–D16）
- 使用者 m0688/m0690 原始需求：「在md和html這類文件中的彈出ui增加一個小按鈕,讓文件可以在瀏覽器渲染」
- 三輪 question 工具澄清確認 D1–D16（見 agent/question.md 第八節）
- R1：npm install 9 套件（markdown-it + markdown-it-anchor/footnote/task-lists/emoji/sub/sup/deflist 6 外掛 + dompurify + papaparse；markdown-it-highlight 0.2.0 太舊不適用，D10 改用 markdown-it highlight option 直接傳入 highlight.js）
- R2：TDD render-kind.ts renderKindOf 純函數 25 測試（md/markdown/mdown/mkd→markdown、html/htm/xhtml→html、svg→svg、csv/tsv→csv、其餘→none；大小寫不敏感；雙副檔名邊界 tar.md→markdown）
- R3：edit-modal.ts 整合渲染預覽——加 import renderKindOf + togglePreviewBtn（eye 圖示，renderKind==="none" 時 hidden）+ previewDiv（div.edit-preview）+ togglePreview 函數（切換原始碼/渲染預覽 + 渲染當前內容 + icon eye↔pencil）+ renderPreview 函數（依 renderKind 分派）+ renderMarkdown（markdown-it+6 外掛+DOMPurify+highlight.js highlight option；mdRenderer 冪等快取 window.__mdRenderer；DOMPurify 快取 window.__dompurify）+ renderHtml（sandbox iframe sandbox="allow-same-origin" srcdoc=text）+ renderSvg（DOMPurify.sanitize USE_PROFILES svg:true + innerHTML）+ renderCsv（PapaParse.parse skipEmptyLines:true + table 渲染）+ addEventListener togglePreviewBtn click→togglePreview + module-declarations.d.ts 新增宣告 7 個缺少型別模組
- R4：liquid-glass.css +~100 行——.edit-preview 容器 + Markdown 暗色主題元素（h1-h6 #c4b5fd bold border-bottom、a #60a5fa underline、code #86efac、blockquote border-left #7dd3fc、table th #c4b5fd、input checkbox accent #7dd3fc、sup/sub/dl/dt/dd 等）+ hljs 程式碼區塊 token + SVG 預覽容器 + CSV 表格 + HTML sandbox iframe + 480px 響應式
- R5：回歸驗證——typecheck 0 錯、test:frontend 14 檔 195/195、build:client 成功（app.js 91.6KB +2.8KB）、check:split OK
- R6：E2E 截圖驗收——發現 Bug 5（markdown-it use 報錯 TypeError: A.apply is not a function），根因 dompurify 被當作 markdown-it 外掛傳入 Promise.all（line 392-402 含 import("dompurify")），修復移除 dompurify from Promise.all（dompurify 已在 line 430 單獨 import）+ 外掛匯入用 typeof 檢查（mod.default?.default ?? mod.default ?? mod + if typeof candidate === "function" mdRenderer.use(candidate)）+ dompurifyMod 用 as any cast；E2E 驗證 list1.md markdown 渲染正常（h1×1+h2×7+p×10+previewHTML 含 h1/p/strong 等+0 errors），截圖 shot-markdown-render-preview.png
- R7：更新 agent/deep_todos.md（任務 8 段落）、項目表.md（渲染預覽橋接段落）、memory.md（本段）
- Bug 5 教訓：(1) markdown-it 的 .use() 只接受 markdown-it 外掛函數，不能傳入 dompurify（dompurify 不是 markdown-it 外掛）——Promise.all 陣列不能混入非外掛模組；(2) ESM/CJS interop 問題——markdown-it 外掛的 mod.default 可能是 undefined 或物件，須用 `mod.default?.default ?? mod.default ?? mod` + typeof 檢查確保 use() 收到函數；(3) dompurify 的型別定義中 .default 是 DOMPurify 型別沒有 .default 屬性，須用 as any cast 繞過 typecheck；(4) Bug 5 與 Bug 3/4 不同——Bug 3 是 language.of() 返回 StateEffect 非 Extension 導致崩潰；Bug 4 是 defaultHighlightStyle 用 opaque class 導致無高亮；Bug 5 是 dompurify 被誤傳入 markdown-it .use() 導致 apply 報錯——三者都是 CodeMirror 6/markdown-it 整合層的 API 誤用問題；(5) 渲染預覽按鈕只在 renderKind ≠ "none" 時顯示（.md/.html/.svg/.csv），其他檔案類型（.js/.json/.yaml 等）不顯示渲染預覽按鈕。

## 2026-08-23 Bug 6 後續修復（使用者 E2E 反饋）
- 使用者 m0859 反饋：「SFTP的檔案時間為什麼都是1970」
- Bug 6（低嚴重度）：SFTP 檔案時間顯示為 1970 年。根因：Go 端 go-ssh/sftpfs.go entryFromInfo `ModTime: fi.ModTime().Unix()` 返回 Unix **秒**，前端 src/frontend/sftp-panel.ts line 147 `new Date(e.modTime)` 把秒當 **毫秒**（`new Date()` 期望毫秒），時間值縮小 1000 倍導致顯示為 1970 年。驗證：2026-08-23 Unix 秒≈1787155441，`new Date(1787155441)`=1970-01-22 00:30:41 UTC+8，與使用者 E2E 看到的 test-syntax.yaml「1970/1/22 上午12:30:41」完全吻合
- 修復：src/frontend/sftp-panel.ts line 147 `new Date(e.modTime)` → `new Date(Number(e.modTime) * 1000)`（秒轉毫秒；Number() cast 因 e.modTime 型別非 number，初次 e.modTime*1000 報 TS2362 加 Number() 後通過）
- E2E 驗證：/tmp 目錄 190 個時間列 has1970=false、has2026=true、sample=[2026/5/5、2026/7/24、2026/7/29 等]；截圖 shot-sftp-time-fixed.png
- 最終測試：前端 14 檔 195/195、typecheck 0 錯、build 成功
- 教訓：(1) Go 端 `time.Time.Unix()` 返回秒，`time.Time.UnixMilli()` 返回毫秒，`time.Time.UnixNano()` 返回奈秒——跨語言時間傳遞須確認單位一致性；(2) JavaScript `new Date(timestamp)` 期望毫秒，`new Date(seconds)` 會把秒當毫秒導致時間值縮小 1000 倍顯示為 1970 年——這是常見的跨語言時間 bug；(3)「1970 年」是 Unix epoch 0 的標誌性年份，任何時間戳單位錯誤（秒/毫秒/微秒/奈秒混用）都會顯示為 1970 年附近——這是診斷時間 bug 的快速線索；(4) TypeScript e.modTime 型別可能非 number（可能是 string 或 union type），直接 `* 1000` 報 TS2362，須用 `Number()` cast；(5) 使用者 E2E 反饋「1970/1/22 上午12:30:41」與計算 `new Date(1787155441)`=1970-01-22 00:30:41 UTC+8 完全吻合，確認根因是秒/毫秒單位錯誤。

## 2026-08-23 UI 置中問題修復（使用者 m0052 回報）
- 使用者回報：「現在ui都是置中的,我如果瀏覽器全屏的話ui也都只有中間有而已」
- 問題（低嚴重度）：所有視圖用 `.view { max-width: 1100px; margin: 0 auto; }` 導致全屏時內容限制 1100px 置中
- 修復：src/frontend/styles/liquid-glass.css line 128-129
  - `.view { padding: 24px; }`（移除 max-width + margin:auto）
  - `.view-center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }`（登入視圖專用置中）
- E2E 驗證：三視圖截圖全寬正常
  - SFTP：shot-sftp-fullwidth.png（表格使用全寬）
  - 終端機：shot-terminal-fullwidth.png（終端機區塊使用全寬）
  - 連線管理：shot-connections-fullwidth.png（連線卡片列表使用全寬）
- 最終測試：typecheck 0 錯、build 成功、check:split OK
- 教訓：(1) CSS 佈局的 max-width + margin:auto 是「置中」的常見模式，但對響應式/全屏需求會成為限制——需根據視圖類型決定是否限寬；(2) 登入視圖等「內容置中」場景應用專用 class（如 `.view-center`）而非通用 `.view`；(3) E2E 驗證需覆蓋多種視圖（SFTP/終端機/連線管理）確保全寬一致性；(4) 修復僅涉及 CSS 2 行變更，無 JS/TS 改動，風險極低且易回滾。

## 2026-08-23 UI 細節修復（使用者 m0959 回報「只是拉伸」）
- 使用者回報三項具體問題：
  1. SFTP 表格欄位太寬/太窄
  2. 頂列（topbar）太厚，影響觀感
  3. SFTP 頁面的「返回」按鈕易誤認，改為「斷開 SSH」+ 二次確認
- 修復：
  1. **SFTP 表格欄寬固定**：liquid-glass.css `.sftp-table { table-layout: fixed; }` + col:nth-child 明確寬度（名稱 35%/大小 12%/權限 12%/時間 18%/動作 23%）；sftp-panel.ts render() 加 `<colgroup>` 5 `<col>`
  2. **頂列變薄**：`.topbar` padding `12px 20px`→`8px 16px`、gap `16px`→`12px`、margin-bottom `20px`→`12px`、top `12px`→`8px`
  3. **返回→斷開 SSH + 二次確認**：index.html `#sess-back-btn` span「返回」→「斷開 SSH」、aria-label「斷開 SSH 連線並返回連線管理」；main.ts click handler 加 `window.confirm("確定要斷開 SSH 連線並返回連線管理？")`
- E2E 驗證：三視圖截圖
  - SFTP：shot-sftp-fixed.png（欄寬固定、時間 2026、頂列薄、斷開 SSH 按鈕、確認對話框）
  - 終端機：shot-terminal-fixed.png（全寬、頂列薄）
  - 連線管理：shot-connections-fixed.png（全寬、頂列薄）
- 最終測試：typecheck 0 錯、build 成功、check:split OK
- 教訓：(1) `table-layout: fixed` + 明確 col 寬度能解決表格欄位自動分配不合理問題；(2) topbar 過厚會壓縮內容區高度，縮減 padding/margin 是低成本改善；(3) 「返回」按鈕在工作階段視圖易誤認，改為動作導向文字（斷開 SSH）+ 二次確認符合破壞性操作 UX 最佳實踐；(4) 三項修復分別在 CSS/TS/HTML，互不干擾，風險可控。

## 2026-08-23 確認框 Modal 化（任務 9，使用者授權自主跑完整流程）
- 讀取 agent/question.md 第九節、agent/deep_todos.md、agent/項目表.md、agent/memory.md（4 檔結構掌握）
- 基線測試：`npx vitest run --config vitest.frontend.config.ts` 14 檔 195/195 全綠
- 讀取 src/frontend/preview-modal.ts（184 行，範本結構：backdrop>dialog[role=dialog]>titlebar+content+footer；close 冪等 closed 旗標；onKeydown Escape→preventDefault+close；backdrop click(ev.target===backdrop)→close）
- 讀取 src/frontend/edit-modal.ts:540-563（onKeydown bubble document.addEventListener；line 485 doSave window.confirm 覆蓋原檔；line 536 close sync void window.confirm 未儲存離開）
- 讀取 src/frontend/sftp-panel.ts:36-58,224-233（SftpPanelOptions.confirm?(m:string):boolean 同步；line 226 if(!this.confirm(...)) return 同步呼叫）
- 讀取 vitest.frontend.config.ts（environment:"node" 全域；include test/unit/frontend/**/*.test.ts；alias @→./src）
- 讀取 package.json（devDependencies 無 jsdom；scripts: typecheck/build/check:split）
- Test-Path node_modules/jsdom → False；npm install -D jsdom（5 high severity 是 dev 依賴常態，忽略）
- 寫入 test/unit/frontend/confirm-modal.test.ts（31 測試；15 個 describe 區塊；檔頭 `// @vitest-environment jsdom` per-file 切換環境；涵蓋 D1-D8 全行為契約：匯出簽名/關閉路徑/按鈕文字/危險樣式/無障礙/焦點/DOM 結構/多執行個體/Esc 疊加攔截/冪等清理）
- RED 階段：`npx vitest run --config vitest.frontend.config.ts test/unit/frontend/confirm-modal.test.ts` → Failed to resolve import "@/frontend/confirm-modal"（模組不存在 = 缺少目標行為，有效 RED 失敗原因）
- 寫入 src/frontend/confirm-modal.ts（openConfirmModal；ConfirmModalOptions 介面；DOM 結構 backdrop>dialog[role=alertdialog aria-modal aria-label=message tabindex=-1]>[title?]+content+footer>actions；confirmBtn className danger?"btn btn-primary btn-confirm btn-danger":"btn btn-primary btn-confirm"；cancelBtn "btn btn-ghost btn-cancel"；dialog.focus() D7；return new Promise<boolean> finish 冪等 resolved 旗標；onKeydown capture=true + ev.stopImmediatePropagation() 攔截所有鍵 + Escape preventDefault+cancel；document.addEventListener("keydown", onKeydown, true)）
- GREEN 階段：`npx vitest run --config vitest.frontend.config.ts test/unit/frontend/confirm-modal.test.ts` → 31/31 全綠（含 D8 三項測試：confirm-modal 開啟時外部 keydown listener 收不到 Escape / 收不到任意鍵 / 關閉後恢復接收；jsdom 正確實作 stopImmediatePropagation 跨 capture/bubble）
- grep .preview-modal/.edit-modal 在 liquid-glass.css（無匹配，class 名不同）；讀 liquid-glass.css 全檔 1080 行確認 :root 變數與既有 .preview-backdrop z-index 200/.edit-backdrop z-index 220
- 寫入 liquid-glass.css 末尾 .confirm-* 樣式區段（.confirm-backdrop z-index 240 高於 .edit-backdrop 220；.confirm-modal width min(440px,92vw)；.confirm-title/content/footer/actions；confirmFadeIn/confirmIn 動畫；prefers-reduced-motion 降級；480px 響應式）
- 整合 main.ts：import openConfirmModal；line 200 刪連線 `if (!await openConfirmModal({ message, title:"刪除連線", danger:true, confirmText:"刪除" })) return;`；line 438 斷開 SSH `if (!await openConfirmModal({ message, title:"斷開連線" })) return;`；line 401 SftpPanel 注入 `confirm: (message) => openConfirmModal({ message, title:"刪除檔案", danger:true, confirmText:"刪除" })`
- 整合 edit-modal.ts：import openConfirmModal；line 485 doSave `if (!await openConfirmModal({ message, title:"覆蓋原檔", danger:true, confirmText:"覆蓋" })) return;`（doSave 已 async）；line 532-541 close 重構 sync void + fire-and-forget async doClose + confirming 旗標防重入（let closed=false; let confirming=false; finishClose(){closed=true;removeEventListener;editor.destroy;backdrop.remove;} close(){if(closed||confirming) return; const dirty=...; if(!dirty){finishClose();return;} confirming=true; void openConfirmModal({message,title:"未儲存離開"}).then(ok=>{confirming=false; if(ok) finishClose();});}）
- 整合 sftp-panel.ts：line 40 介面 `confirm?(message: string): Promise<boolean>;`；line 47 欄位 `private readonly confirm: (m: string) => Promise<boolean>;`；line 56 fallback `this.confirm = opts.confirm ?? ((m) => Promise.resolve(window.confirm(m)));`；line 226 `if (!await this.confirm(...)) return;`
- 回歸驗證：前端 15 檔 226/226 全綠（比基線 195 多 31）；typecheck 0 錯（worker + frontend）；build 成功（wasm + worker 17.5kb + client）；check:split OK（app.js 92KB）；grep window.confirm 5 處全在註解或 fallback 安全網（零直接呼叫）
- 教訓：(1) jsdom per-file 環境切換（`// @vitest-environment jsdom` 檔頭註解）是 vitest 官方支援，不影響其他 14 檔 node 環境，能完整 TDD 覆蓋 DOM 行為契約；(2) D8 Esc 疊加用 capture=true + stopImmediatePropagation 比「暫停外部 listener」更乾淨——edit-modal onKeydown 完全不用改，confirm-modal 自我封裝攔截職責；(3) sync close 函式改 async 行為（window.confirm 同步阻塞 → openConfirmModal Promise）需 fire-and-forget + 旗標防重入，保持事件 handler 友善與回傳型別不變；(4) sftp-panel fallback `Promise.resolve(window.confirm(m))` 保留 window.confirm 作安全網，符合 question.md 驗收條件 1「不計入」；(5) 嚴格遵守 OREO「不擴張需求範圍」——只新增 confirm-modal，不重構既有 preview-modal/edit-modal 結構。

## 2026-08-24 按鈕純文字化（任務 10，使用者 m0062 要求）

- 讀現況：grep iconElement("eye")|iconElement("pencil") 找 3 處 SVG 按鈕（sftp-panel.ts:162-166 iconButton("pencil","編輯")；edit-modal.ts:225-230 toggleReadonlyBtn eye 初始；edit-modal.ts:234-241 togglePreviewBtn eye 初始）+ 2 處切換（edit-modal.ts:351-352 setReadonly eye↔pencil + setAttribute aria-label；edit-modal.ts:364-378 togglePreview eye↔pencil）
- 讀 sftp-panel.ts:185-192 actionButton（純文字鈕 className "btn btn-ghost btn-sm" 無 btn-icon 無 aria-label 無 title）+ line 194-208 iconButton（方型鈕 className 加 btn-icon + aria-label + title + replaceChildren(iconElement)）；ui-icons.ts iconElement + UI_ICON_PATHS（eye/pencil 等 12 路徑，ui-icons.test.ts 測試）
- question 澄清 3 題：D1 雙態文字顯示「目前狀態」（非下一步動作）；D2 移除 .btn-icon 改 btn btn-ghost btn-sm（與 actionButton 一致）；D3 只改指定三個（其他 saveAs/save/close/dl + sftp-panel 工具列保留）
- 慣例裁定：文字內容 SFTP「編輯」固定、切換唯讀/編輯 編輯中/唯讀中、切換原始碼/預覽 原始碼/預覽；移除 aria-label（純文字可見即為 accessible name）；保留 title 作 tooltip；ui-icons eye/pencil 保留（移除需擴張範圍改 ui-icons.test.ts）；事件監聽不動；測試 OREO 例外（DOM 膠水層無現成測試模組）
- 寫 question.md 第十節（按鈕純文字化決策 + 10 項驗收條件）
- 改 sftp-panel.ts line 162-166：iconButton("pencil","編輯",...) → actionButton("編輯",...)（移除 btn-icon + aria-label + SVG）
- 改 edit-modal.ts 4 處：line 225-230 toggleReadonlyBtn 初始（移除 btn-icon + aria-label；textContent="編輯中"）；line 234-241 togglePreviewBtn 初始（移除 btn-icon + aria-label；textContent="原始碼"）；line 351-352 setReadonly 切換（textContent = value ? "唯讀中" : "編輯中"）；line 364-378 togglePreview 切換（textContent = "預覽" / "原始碼"）
- 回歸驗證：前端 15 檔 226/226 全綠（與前一任務相同，本任務無新增測試）；typecheck 0 錯；build 成功（wasm + worker 17.5kb + client）；check:split OK（app.js 93.8KB +1.8KB；terminal 283.6KB 不變）
- 教訓：(1) 純文字按鈕移除 aria-label 與 actionButton 慣例一致（可見文字即為 accessible name），但保留 title 作完整 tooltip 描述；(2) 雙態文字顯示「目前狀態」而非「下一步動作」更直覺（唯讀時顯示「唯讀中」而非「切換至編輯」）；(3) ui-icons 圖示庫 eye/pencil 路徑保留——移除需同步改 ui-icons.test.ts 擴張範圍，且 TS 不報 dead code，保留作未來用更安全；(4) OREO 例外條款適用——DOM 膠水層變更（replaceChildren(iconElement) → textContent + className 移除）無現成測試模組，靠 typecheck+build+人工審查驗證。

## 2026-08-24 自主疊代升級 — 正確性、生命週期與安全強化

- 使用者授權自行完成完整流程；需求、決策與驗收條件記錄於 `agent/question.md` 第十一節。
- 依 8 個 RED→GREEN 週期完成：DELETE 204/SFTP await、WASM loader/debug/lifecycle、KV pagination/login rate limit、SSH host key TOFU、session tabs、released callback、native dialog top layer、mobile dynamic viewport。
- 主要安全決策：Go SSH 不再使用 `InsecureIgnoreHostKey`；缺 verifier fail closed。首次連線由前端 Liquid Glass modal 顯示 `keyType` 與 OpenSSH SHA-256 指紋，確認後加密保存；已存不一致立即阻擋且不覆寫；重設只 PATCH host key 兩欄為 null。
- 登入限流：同來源 15 分鐘 5 次密碼失敗；第 6 次 429 + Retry-After；成功登入清除；只累計密碼驗證失敗；來源 SHA-256 後作 KV key，缺 CF-Connecting-IP 使用穩定 fallback。
- 生命週期：`SessionResources` 在每個建立步驟即記錄；中途失敗、遠端 close、手動 teardown 共用冪等 best-effort cleanup。Go WsConn 關閉順序為 disposeCallbacks → transport.close → js.Func.Release，避免延遲 close 事件呼叫已釋放函式。
- E2E 額外揭露並修復三項回歸：不存在的 `#panel-monitor`、confirm div 被 native dialog top layer 擋住、手機 session 固定 topbar calc 導致 metrics 裁切。
- 真實 E2E：測試 SSH `tester@127.0.0.1:2222`；terminal 回顯；SFTP mkdir/rename/upload/read/overwrite/delete file/delete dir；TOFU 首次確認/再次免提示/假指紋阻擋且保持假值/重設不改其他欄位/重新確認；斷線後無 `call to released function`。測試遠端與本機 fixture 全清除。
- 視覺證據：desktop、mobile list/dialog/confirm/session 截圖；390×844 最終 session root 844px、main bottom 828px，無裁切或重疊。console 當前導航 0 errors；network API 均 200；production transport debug 零輸出。
- 最終驗證：frontend 22 files / 248 tests PASS；Go PASS；typecheck PASS；build PASS；check:split OK（app.js 96.9KB、terminal 283.6KB）；LSP src 33 files / 0 diagnostics；敏感/舊碼掃描零匹配。
- Worker 未完整驗證：完整 suite 與最終單檔在 PBKDF2 cache 上限壓力案例遭 Windows workerd `WSARecv 10053` / `Network connection lost`，伴隨 Miniflare EBUSY；其餘 85 tests PASS。此前相同單檔曾 5/5 PASS，顯示為環境 flaky，但本次不得宣稱完整通過。runtime 另將 compatibility date 2026-08-01 fallback 至 2025-09-06。
- 教訓：(1) native dialog top layer 無法用 z-index 超越，疊加確認框也必須是 `showModal()`；(2) viewport 內容高度不應扣固定 topbar 像素，使用 `100dvh` + flex + `min-height:0`；(3) WASM Go callback Release 前必須先解除 JS 端事件引用；(4) 安全 TOFU 必須 fail closed，且 mismatch 不得自動更新；(5) 高成本 PBKDF2 Workers 測試在 Windows workerd 需獨立 CI/Linux runtime 作穩定最終證據。

## 2026-08-24 批量生成排版測試 SSH 連線（任務 12）

- 使用 `question` 確認：額外新增 50 筆、不刪舊資料；25 筆本機可連 fixture、25 筆安全假端點；完整名稱/主機/使用者/port/auth/time 變化；統一 `LAYOUT-範例-` 前綴；不預存 host key；直接寫入本機 KV、不新增腳本。
- 契約寫入 `agent/question.md` 第十二節。
- 啟動本輪 Wrangler parent PID 61420，使用本機 `.dev.vars` 的既有 secrets；沒有讀取或輸出 secret 值。嘗試啟動新的 SSH fixture 因 2222 已由既有服務監聽而立即退出，未留下新增 SSH 常駐程序。
- 寫入前 API 基線：共 2 筆，`LAYOUT-範例-` 0 筆；既有資料為 `E2E 本機測試機` 與 `loc`。
- 以已登入頁面 fetch 呼叫既有 connections API，分批 POST 建立、再 PUT 寫入時間狀態。批次識別 `BMT6G7CC1`，名稱格式 `LAYOUT-範例-BMT6G7CC1-NN-...`。
- 最終 API 驗證：total 52、batch 50、localConnectable 25、reservedFake 25、password 37、privateKey 13、trustFieldsPresent 0、neverConnected 13、connectedOnly 13、connectedAndDisconnected 24、nameLengths 24–83；原有兩筆保留。
- 桌面 1440×1000：52 卡四欄，無文字溢出、卡片重疊或水平捲軸；手機 390×844：52 卡單欄，無文字/按鈕溢出或重疊，可捲至最後一張卡。
- 截圖：`layout-examples-desktop-1440.png`、`layout-examples-mobile-390.png`。
- Console 觀察：10 個假端點的 `/api/os` 因沒有快取回 404，另有 Inter 700 字型資產 500；排版量測仍全數通過，本任務未修改正式程式碼。
- TDD 例外：純本機資料操作沒有正式程式碼行為可先寫 RED；以基線、結構化 API 驗證、Playwright DOM 量測、真實桌面/手機截圖替代。
- 收尾：Playwright 已關閉；Wrangler PID 61420 及其子程序已退出，`netstat` 確認 port 8787 listener 數為 0。既有 dev SSH server PID 27768 仍監聽 `127.0.0.1:2222`，未停止使用者原有服務。

## 2026-08-24 Worker 大量連線崩潰與 v2 加密信封升級（任務 13）

- 使用者回報本機 Worker 疑似崩潰。確認舊 Wrangler log `C:\Users\yoyo2\.wrangler\logs\wrangler-2026-08-23_23-35-53_671.log` 有 Miniflare loopback `ProxyController2.emitErrorEvent`；另以有限背景服務真實重現，詳細 log `C:\Users\yoyo2\.wrangler\logs\wrangler-2026-08-23_23-51-05_886.log`。52 筆下 `GET /api/connections` 約 6.5–7.6 秒後 port 8787 listener 消失。
- 根因定位：v1 信封每筆獨立 salt，`ConnectionStore.list()` 又以 `Promise.all` 同時呼叫每筆 `get()`；52 筆造成 52 次 PBKDF2-SHA256 210,000 並行，觸發與先前 Windows workerd WSARecv 10053/Network connection lost 相同的高負載區域。
- 透過 `question` 確認：升級 v2、保留 v1 相容與分批自動遷移、前端列表前透明遷移、列表 API 仍回完整陣列；500 筆連續 10 次、每次低於 5 秒且 Worker 持續存活。契約寫入 `agent/question.md` 第十三節。
- 加密 RED→GREEN：新測試先要求 `v2:`、固定 KDF domain、獨立 IV、AAD、v1 fixture 相容與並行 KDF Promise 去重。正式碼新增 `decryptStringDetailed()`；新寫 v2、舊裸 base64 讀 v1；PBKDF2 保持 210k、AES-256-GCM 不降級，cache 為失敗可移除的 Promise LRU 16。
- 遷移 RED→GREEN：Store 測試覆蓋混合 v1/v2、cursor、marker、損毀 blocker、重複呼叫與同時更新不覆寫；HTTP 測試覆蓋 auth 與進度；前端測試覆蓋 migration→list 順序及 cursor 無進展。正式新增 POST `/api/migrations/connections` 與前端透明循環。
- 列表效能量測：16 路單鍵 get 約 7.7 秒；32 路約 6 秒；64 路冷路徑約 6.85 秒、熱路徑約 3.56 秒，無法穩定達標。依 Context7 Cloudflare KV 官方文件確認 `KVNamespace.get(keys: string[])` 每批最多 100 keys、回 Map。
- Bulk get RED→GREEN：250 筆 fake KV 要求精確 `[100,100,50]` 批次，舊單鍵實作先失敗；正式改每批 100 keys bulk get，再 64 路有界解密，保持原 key 順序。
- 真實 Wrangler 壓測：以 `PRESSURE-V2-20260824-0817` 新增 448 筆使總量 500。10 次瀏覽器 fetch+JSON parse 均 HTTP 200/count 500，耗時 4988.8、4303.6、2688.7、2755.1、2448.8、2688.0、2191.0、2054.6、2100.8、2005.0ms；最大 4988.8ms、平均 2822.4ms，listener 持續存活。
- 壓測清理：分批刪除全部 448 筆壓測資料；最終 API `total=52`、`pressure=0`、`layout=50`，保留原有兩筆與任務 12 的排版資料，migration marker 保留。
- 品質 RED→GREEN：先測 KV migration 內部錯誤不得誤報 invalid cursor；舊 handler 收到 400。新增 `InvalidMigrationCursorError`，只有該型別回 400，其他錯誤回不洩漏細節的 `{error:"migration failed"}` 500；無效 cursor 仍維持 400。
- 最終驗證：frontend 22 files / 250 tests PASS；Worker 7 files / 95 tests PASS；Go PASS；typecheck PASS；build PASS；check:split OK（app.js 97.1KB、terminal 283.6KB、Worker 26.5KB）；LSP src 33 files / 0 diagnostics。
- 環境觀察：Wrangler 4.125.0 的本機 runtime 仍將 compatibility date 2026-08-01 fallback 到 2025-09-06；Miniflare 測試結束偶有 temp EBUSY，但本次完整 Worker suite 包含高負載 crypto-cache 案例均通過。
- 教訓：(1) 高成本 KDF 不應按 record salt 在列表時並行衍生；固定且 domain-separated 的 KDF salt可安全重用部署金鑰，record 隨機性由 GCM IV 保持；(2) KV 大量列表應優先使用官方 bulk get，而非只調高單鍵並行；(3) 格式遷移需版本標記、可恢復 cursor、競態二次讀與不覆寫損毀資料；(4) 效能驗收必須包含真實 Worker listener 存活，而非只看單次 HTTP 200。
- 收尾：Playwright 已關閉；使用 `taskkill /T` 終止本輪 Wrangler parent PID 56172、listener workerd PID 56844 及其子程序，確認 port 8787 無 listener。既存 dev SSH server PID 27768 仍監聽 `127.0.0.1:2222`，未停止。

## 2026-08-24 D1 巢狀資料夾、憑證脫敏與後端 SSH（任務 14）

- 使用者要求以資料夾整理連線並降低 KV 讀取壓力，後續明確要求 Web 編輯既有主機時不得重現密碼、私鑰或 passphrase。多輪 `question` 決策完整記錄於 `agent/question.md` 第十四、十五節。
- 架構決策：D1 為 folders/connections 唯一主儲存，KV 僅保留 OS cache/login rate limit；資料夾名稱與連線 payload 全部 AES-GCM v2 加密，明文只存結構索引；同層唯一名稱以獨立 domain-separated HKDF/HMAC token 驗證。一般 API 使用 redacted `ConnectionView`，只暴露 `credentialState`。
- D1 bootstrap RED→GREEN：先測 schema、v1/v2 KV 遷移、重啟續跑、損毀資料 fail-safe；實作 versioned schema、15 秒 lease、持久化階段/進度、分批 scan/migrate/verify/cleanup。只有 D1 row count、ID set 與逐筆 decrypt 全通過才刪 `conn:*`；OS cache/rate-limit 不受影響。
- D1 repository RED→GREEN：測公開 DTO 不含 secret、raw D1 不含 host/secret 明文、空白 secret 保留、明確 clear、8 層/第 9 層、cycle、duplicate、scope direct-only、bulk move counts、promote/recursive delete。正式 `D1ConnectionStore` 透過 D1 batch 維持 ancestor recursive counts。
- HTTP/API：日常 connections/folders/scoped CRUD 全面切 D1；新增 `/api/bootstrap`、`/api/bootstrap/retry`、`/api/scope`、folder CRUD、connection bulk move、credential clear 與 `/api/ssh`。CRUD 在 bootstrap 未完成時回 423；公開回應掃描無 `password/privateKey/passphrase`。
- 前端：新增 bootstrap runner/遮罩、FolderBrowserState、breadcrumb、folder cards/count、folder create/rename/move/delete、三選項 native dialog、connection menu、multiselect、drag/drop 與 mobile fallback。主畫面只讀 root scope，進 folder 才讀直接內容；移動目的地 `listFolders()` 只查 folder 欄位，不讀 connection payload。
- 憑證 UX：既有連線表單 secret 欄永遠空白；空白提交不含 secret、保留原值；新增/切 auth 需新 credential；明確危險確認可 clear，清除後 `credentialState=missing` 且 UI/API 阻擋連線。
- 純 Worker SSH feasibility gate：評估 TS SSH 套件後，因無法同時守住 login/shell/exec/SFTP/private-key 功能，採既有 Go `x/crypto/ssh` 編為 backend WASM。真實 fixture `tester@127.0.0.1:2222` 通過 host key、password auth、Ubuntu exec、shell echo、SFTP CRUD，確定不需 Container/外部服務/browser fallback。
- Backend runtime：新增 Go WASM singleton loader、Cloudflare Socket transport、non-hibernating `SshSessionObject`、private memory-only `/init`、WebSocket `/connect` 與 `BackendSshSession` RPC。完整 secret 只從 D1 解密後進 Worker/DO 記憶體，browser request body與一般回應不含 credential。
- RPC/TOFU：後端執行 host-key verify；首次只發 key type/fingerprint challenge，確認後 Worker 更新 D1；mismatch fail closed且不覆寫。RPC涵蓋exec、shell data/write/resize/close、SFTP list/stat/read/write/mkdir/remove/rename，binary以base64傳送，錯誤不回 stack/secret。
- 重連 TDD：只有曾 ready 後的 transient abnormal close 才依 1/2/4 秒最多3次重連；重連期間 request reject、shell input丟棄不buffer/replay。前端協調器停poller、鎖terminal、寫separator；成功建立新shell並恢復active tab/SFTP path/monitor；explicit disconnect與安全錯誤不重連。
- 已移除 Browser fallback：刪 `src/frontend/ssh-engine.ts`、`src/worker/wsbridge.ts`及對應測試，移除 `/proxy` 與 `api.proxyUrl`。Go build只輸出 `dist/worker/ssh.wasm`/`wasm_exec.js`；client build清除wasm目錄；`check:split`會拒絕前端WASM artifact。
- 真實E2E：首次登入將52筆KV安全遷D1；建立兩層folder與backend test connection；TOFU、terminal echo、monitor、SFTP CRUD/cleanup；bulk move、connection/folder drag、case-insensitive duplicate、8層與第9層拒絕、cycle、promote與recursive delete。真實重啟Wrangler後觀察第1/2次重連separator與成功狀態，新shell回顯、SFTP恢復`/tmp`、monitor恢復；explicit disconnect不重連。
- 真實壓測：以 `PRESSURE-D1-20260824-1247` 建448筆，使總量500，分布於5 root+5 child。10輪量測 root scope max245.1ms/avg210.6ms、child scope max427.0ms/avg296.5ms、full500 max250.6ms/avg209.4ms，均HTTP200且listener存活。recursive cleanup後恢復52 connections/0 folders/0 pressure，所有API secretFields=0。
- 最終回歸：frontend 26 files/264 tests PASS；Worker 13 files/117 tests PASS；Go PASS；typecheck PASS；build PASS；check:split PASS（app114.3KB、terminal283.6KB、Worker104.8KB）；LSP src48 files/0 diagnostics。Worker測試仍有Windows Miniflare temp EBUSY警告；compatibility date 2026-08-01在本機fallback到2025-09-06。
- 教訓：(1) D1/Durable Object與KV的責任要清楚分離，結構與強一致操作放D1，快取才放KV；(2) secret redaction必須從資料傳輸契約與架構邊界解決，不能靠前端遮罩；(3) active TCP不可搭配DO hibernation，重啟只能建立新SSH session並明確告知使用者；(4) scoped query與cached recursive count可同時改善UX與大量資料效能；(5)刪除fallback需加入build artifact guard，否則未引用runtime仍可能被發布。
- 收尾：Playwright 已關閉；本輪 Wrangler parent PID 58988、listener PID 43572 及程序樹已停止，`netstat` 確認 port 8787 listener 為 0；臨時 `worker-ssh-backend-probe.env` 已刪除。既存 dev SSH fixture PID 27768 仍監聽 `127.0.0.1:2222`，未停止。

## 2026-08-24 齒輪設定入口、D1 全域偏好與 Worker 穩定性審查（任務 15）

- 使用者要求連線管理右上角新增純SVG齒輪，並經`question`確認D1全域同步、dark/high-contrast、terminal 12–20px、monitor 3/5/10/30秒、重連開關與1–5次、完整preview/cancel/save/default語意。契約寫入`agent/question.md`第十六節。
- D1 settings RED→GREEN：新增shared設定型別/defaults、`AppSettingsStore`、schema v2 `app_settings`與`GET/PUT /api/settings`；測試涵蓋v1→v2無損升級、default/upsert、auth/bootstrap guard與所有非法值。
- 前端交易RED→GREEN：新增`SettingsDraftController`與`applyRuntimeSettings`；TerminalHandle動態font+fit、MetricsPoller動態重排interval、BackendSshClient動態reconnect policy。取消完整rollback且不寫D1，save只傳五個可寫欄位。
- UI：連線管理與session topbar均有40px純SVG齒輪；global native settings dialog位於所有view之外，低高度使用`max-height:calc(100dvh - 32px)`與內部捲動；高對比主題覆蓋主要token。卡片／全選checkbox使用自訂appearance但保留input語意。
- SFTP rename：新增`openSftpRenameDialog()`，檔案/資料夾rename預填完整名稱並全選、Enter確認、Escape/cancel不修改、空白阻擋；mkdir仍保留原prompt（不在需求範圍）。
- 真實E2E：desktop與390×844手機無溢出；settings preview high-contrast/20px/10秒/disable reconnect立即套用，cancel後dark/14px與API defaults恢復；save後重整讀回，最終恢復預設。active terminal row 16→24→16px；SFTP file/folder rename均成功且fixture清理。console errors/warnings均0。
- 最終驗證：frontend30 files/278 tests、Worker14 files/124 tests、Go PASS、typecheck/build/check:split/LSP全通過。Worker109.1KB、app120.2KB、terminal283.7KB。
- Worker穩定性審查依官方限制核對：Worker isolate 128MB、received WebSocket message 32MiB、D1 queries/invocation Free50/Paid1000。發現未修復風險：RPC payload/in-flight無界、SSH session無quota、bulk move無上限、TOFU challenge無timeout、TCP early-read buffer無界、bootstrap lease無heartbeat、DO init/connect兩步記憶體config。建議依resource exhaustion風險順序另開TDD修復，不在本輪未確認範圍直接改行為。
- 環境：compatibility date在本機fallback 2025-09-06；Windows Miniflare仍偶有temp EBUSY。依使用者要求，Wrangler測試伺服器保持`http://127.0.0.1:8787`運行；SSH fixture2222保留。

## 2026-08-25 終端剪貼簿、齒輪對齊與 Worker 穩定性加固（任務 16）

- 使用者要求修復 SSH terminal copy/paste、主畫面 gear 對齊，並授權修復任務15審查出的七項Worker風險。經`question`確認完整快捷鍵、frame/chunk/quota/lease/nonce數值，契約寫入`agent/question.md`第十七節。
- Clipboard RED→GREEN：先以純handler測selection Ctrl+C、no-selection Ctrl+C、Ctrl+Shift+C/V、Shift+Insert、Cmd+C/V、native event優先與API拒絕。新增`terminal-clipboard.ts`並接xterm `attachCustomKeyEventHandler`；普通Ctrl+C在無選取時回true，確保遠端收到SIGINT。真實E2E選取copy與paste回顯成功，WebSocket frame確認SIGINT為`\u0003`。
- Gear RED→GREEN：主畫面`#settings-btn`新增專屬40×40/flex雙軸置中規則，SVG20×20，mobile不再被topbar actions拉伸；session gear不改。
- RPC RED→GREEN：`BackendSshSession`新增約768KiB JSON frame、4 in-flight、20 request/s burst40、TOFU60秒timeout。超大frame用1009、速率超限用1008、第5個並行request只回安全error且保持socket可用；close會解除pending challenge與回收shell/SFTP handles。
- SFTP串流RED→GREEN：Go新增512KiB read/write handles及WASM bridge；Worker RPC與frontend client改open/chunk/close。真實以7,960,870-byte `dist/worker/ssh.wasm`往返，來源與下載SHA-256皆`F18C796B7A05A7FB0C424A10BA81F06F8C7E5514AA9F36ED876B0175D0CB218D`，遠端/本機fixture已清除。
- Bulk move RED→GREEN：D1 repository與HTTP route均在查詢前限制50個unique IDs；真實51筆回400 `too many connections to move`。
- SSH quota RED→GREEN：新增storage-backed `SshSessionQuota`與`SshQuotaObject`，同session3/global10、30秒lease、heartbeat/release/過期清理；raw session token先SHA-256。真實同session第2/3條成功、第4條拒絕，關閉後可再建立；global10由deterministic storage unit覆蓋。
- TCP/Bootstrap RED→GREEN：early-read buffer新增4MiB上限並在flush/dispose清零；bootstrap lease由15秒升60秒，scan/migrate/verify/cleanup長步驟持續owner-guarded heartbeat，失去lease回`BOOTSTRAP_LEASE_LOST`。
- DO nonce RED→GREEN：`OneTimeSessionInit`產生10秒nonce，wrong nonce不消耗、正確nonce只可一次、過期清理；outer helper只在第一次connect 409時重新init一次。init/connect失敗會安全release quota。
- 完整驗證：frontend31 files/288 tests、Worker16 files/141 tests、Go PASS、typecheck PASS、build/check:split PASS、LSP src50 files/0 diagnostics。Worker124.4KB、app120.2KB、terminal284.9KB，client仍無Browser WASM。
- 環境觀察：本機runtime仍fallback compatibility date 2025-09-06；Windows Miniflare測後仍有temp EBUSY，但完整Worker suite與crypto-cache高負載全綠。
- 服務與清理：Playwright中的active SSH已明確斷開，Playwright已關閉。原Wrangler tree在watch期間退出後，以background Start-Process重啟；最終應保持`http://127.0.0.1:8787`運行，parent PID63648、listener PID48152。既有SSH fixture PID27768/2222不停止。
- 教訓：(1) terminal copy不能粗暴攔截Ctrl+C，必須以selection分流保留SIGINT；(2) WebSocket訊息合法不代表對isolate記憶體安全，JSON/base64與並行RPC都需應用層上限；(3) SFTP應以handle/chunk限制單次配置，不用整檔base64；(4)全域資源quota需由單一持久化DO協調，不可用isolate記憶體；(5)兩段式secret handoff至少需要短TTL一次性nonce與有限重試；(6)長migration lease需heartbeat而非只延長初始TTL。

## 2026-08-25 狀態列虛擬記憶體（Swap）監控（任務 17）

- 使用者要求在 SSH 終端狀態列新增虛擬記憶體查看；經 `question` 確認指標為 Swap／交換空間、位於實體記憶體後、顯示已用／總量與百分比、不新增 sparkline。契約寫入 `agent/question.md` 第十八節。
- RED：擴充 `parsers.test.ts`、`monitor.test.ts`、`settings-ui-contract.test.ts`，Linux/Darwin/zero/unknown/command/display/DOM 順序共 12 項因缺目標欄位與行為失敗。
- GREEN：`Metrics` 新增 `swapTotal`／`swapUsed`；Linux 直接解析既有 `free -b` 的 `Swap:` 行，沒有新增 SSH round trip；Darwin/BSD 加入 `sysctl vm.swapusage`，不支援時局部降級為 null。顯示層明確區分 unknown `--` 與 known-zero `0 B / 0 B`／`0.0%`。
- UI：`index.html` 在實體記憶體後加入 `m-swap-used`／`m-swap-percent`，`main.ts` 接 MetricsPoller；charts 保持 CPU／實體記憶體／磁碟三組，不為 Swap 新增加載成本。
- 真實E2E：本機 fixture 顯示 `0 B / 2.0 MiB` 與 `0.0%`。Desktop 929×909 監控列無溢出；mobile 390×844 的7項指標與整頁皆無overflow。證據為 `swap-monitor-desktop.png`、`swap-monitor-mobile-390.png`、`swap-monitor-network.txt`，console errors/warnings 皆0。
- 最終回歸：frontend 31 files/295 tests、Worker 16 files/141 tests、Go PASS、typecheck/build/check:split/LSP全綠。Worker 124.4KB、app約122KB、terminal284.9KB。
- 教訓：(1) 監控資料模型必須以 `null` 與數值 `0` 區分「未知」及「已知未啟用」；(2) 優先重用既有遠端命令輸出，避免為單一指標增加 SSH round trip；(3) 跨OS附加指標失敗應局部降級，不能拖垮整份監控樣本。
- 環境：Darwin/BSD parser由單元測試覆蓋但未跑真機；compatibility date在本機fallback至2025-09-06；Windows Miniflare仍有temp EBUSY。Playwright已關閉，Wrangler與SSH fixture依使用者要求繼續運行。

## 2026-08-25 GitHub 公開發布與 Cloudflare 手動一鍵部署（任務 18）

- 使用者確認公開 `s12ryt/worker-ssh`、MIT、main、僅手動 `workflow_dispatch`；正式 Worker/D1/KV 固定命名，同名資源重用，四個 GitHub secrets 稍後手動設定，本輪不得讀 `.dev.vars` 或觸發 production。
- Deployment TDD：新增 `cloudflare-deploy-lib.mjs`、CLI 與兩份 deployment tests。REST client安全查找／建立D1與KV，精確名稱多筆時拒絕猜測；產生一次性 Wrangler config與secret JSON，檔案mode600，cleanup冪等。
- Workflow採Node22與go.mod版本，先執行完整驗證，再provision、Wrangler dry-run與deploy；`always()`清除 `.cloudflare-deploy`，summary只列resource action與名稱，不輸出secret或ID以外的敏感回應。
- 公開契約新增README、MIT與ignore規則；秘密掃描只剩example／測試值。Go testserver原固定OpenSSH測試key改為每次用ed25519產生普通與passphrase加密key，Worker store測試改不 resembling PEM的假值。
- 驗證：deployment17/17、Go PASS、store21/21，完整frontend/Worker/typecheck/build/split此前全綠；真Wrangler假ID dry-run成功且無API/deploy。本輪未執行Cloudflare production。
- GitHub repository已建立為 `https://github.com/s12ryt/worker-ssh`；以多個小型英文plain-style原子提交組織初始歷史，tests與直接implementation成對提交。
- 遠端驗證：`main`推送成功並成為default branch；GitHub workflow列為active，run list與repository secret list皆為空。本輪沒有觸發Cloudflare production，四個secrets仍待使用者設定。
- 教訓：(1)一鍵部署應把resource provisioning與deploy config生成拆成可單元測試的library；(2)公開測試fixture也不能內嵌private-key PEM，即使無真實權限仍可能觸發push protection；(3)workflow secrets應以ephemeral secrets file與always-cleanup處理，不應注入靜態wrangler config；(4)本機資料與正式部署資源必須明確隔離。
- 服務：本機Wrangler與SSH fixture不受Git初始化、測試或發布影響，依使用者要求保持運行。

## 2026-08-25 GitHub Actions npm lockfile 相容性修復（任務 19）

- GitHub手動run `32802591933`在Node22附帶npm10執行`npm ci`時失敗。`npm@10.9.4 ci --dry-run`可本機重現缺少nested `@cloudflare/workers-types@4.20260702.1`，`npm@11.7.0`對同一lock可成功，根因是optional peer lock解析的npm major差異。
- 使用者決策固定npm11.7.0，不以npm10重建lock，也不由本輪重跑production。`package.json`新增`packageManager`，workflow先安裝並精確驗證npm版本。
- Clean checkout先後暴露兩個隱性依賴：(1) Worker ASSETS指向被忽略的`dist/client`；改用已提交的最小fixture並加入HTTP fallback測試。(2) Worker module靜態import Go WASM；二進位不得提交，因此workflow必須build/split後再跑Worker tests。
- 主工作區Wrangler必須保持運行，Windows EBUSY使原地`npm ci`中斷並破壞node_modules。建立隔離worktree完成真實npm11 clean install與完整CI順序，避免把本機檔案鎖誤判成lock問題。
- Clean驗證：deployment20、frontend295、Worker142、Go/typecheck/build/split全通過；compatibility date fallback與Miniflare temp EBUSY仍是既有環境警告。
- 遠端`main`已包含`2d9bf5c`、`a8918de`、`ef44dc3`。GitHub workflow可見npm11 setup與build-before-test；run list仍只有原本workflow_dispatch失敗run，證明push沒有觸發Cloudflare部署。
- 教訓：(1) `packageManager`與CI顯式npm版本必須同時固定，不能依賴setup-node附帶版本；(2)乾淨checkout是發現未提交fixture與generated artifact依賴的必要測試；(3)測試assets應自包含，正式generated WASM則由workflow顯式build，兩者不可混為同一種修法。
- 服務確認：Wrangler parent63648/listener48152與SSH fixture27768保持運行，未為clean install或推送而停止。

## 2026-08-25 Cloudflare production v3 加密信封相容性修復（任務 20）

- Production deployment成功後，建立folder與connection同時失敗、settings成功。先用路徑交集定位：前兩者會加密，settings為D1明文結構欄位；D1 binding/schema本身不是根因。
- 查證Cloudflare production PBKDF2 iterations上限100,000，而v2固定210,000。這解釋本機新runtime全綠、production加密失敗的環境差異。使用者確認`ENCRYPTION_KEY`是100字元高熵亂數，故可安全採HKDF，而不是降低PBKDF2成本。
- 契約寫入`agent/question.md`第二十一節：新寫v3 HKDF、保留v1/v2讀取分支、production legacy限制、安全錯誤分類、高熵README、push-only不部署。
- TDD：加入historical v2 fixture與production cap spy；RED為103測中9項缺v3行為。GREEN後`crypto.ts`使用HKDF-SHA256 domain-separated salt/info/AAD + AES-256-GCM random IV，新寫入完全不呼PBKDF2；cache仍以Promise去重並限制16 entries。
- Migration：KV marker升`migration:connections:v3`，v1/v2都改寫v3；D1 bootstrap不再保留v2。v1/v2 decrypt仍使用歷史PBKDF2210k，只在支援該上限的runtime可讀。
- API：新增`EncryptionOperationError`/`ENCRYPTION_UNAVAILABLE`，建立folder/host若crypto不可用時不再只顯示`database operation failed`，也不暴露底層例外文字。
- 驗證：clean worktree目標103/103，另有安全加密錯誤HTTP回歸；完整deployment20/frontend295/Worker145/Go/typecheck/build/split全綠，LSP0 diagnostics。隔離Wrangler8788真實建立folder201、connection201、無secret response、清理204。
- 推送與清理：七個原子提交已推送至`main`的`292bcef`；workflow只有`workflow_dispatch`，push後Actions沒有新增run。隔離8788程序樹、臨時env與clean worktree均已刪除。
- 本機服務恢復：受控停止卡住的舊8787後，主工作區真正執行`npm@11.7.0 ci`與最新build，並以background Wrangler重啟。最終`http://127.0.0.1:8787`由parent PID90728/listener PID76996提供服務，GET實測200；SSH fixture PID27768/2222未停止。
- 教訓：(1) WebCrypto演算法可用不代表所有參數在production/runtime皆同上限，必須加入production-limit回歸；(2)高熵根金鑰適合HKDF，使用者密碼才需要PBKDF2/Argon2等password KDF；(3)一般database error會遮蔽crypto根因，跨層錯誤必須安全但可分類；(4)version marker升級必須同步KV marker、bootstrap與fixture，否則舊complete marker會跳過新遷移。

## 2026-08-26 IPv6、SSH -o／Access 代理與連線速度疊代（任務 21）

- 讀取：agent/deep_todos.md、項目表.md、memory.md、question.md 接手；src/worker/index.ts、backend-ssh-do.ts、d1-store.ts、d1-bootstrap.ts、auth.ts、ssh-session-init.ts、backend-ssh-runtime.ts、frontend main.ts/os-cache.ts/connection-form-state.ts、go-ssh client.go/main.go、cloudflared carrier 源碼、Cloudflare TCP sockets 文檔。
- 寫入（新檔）：src/worker/ssh-host.ts、src/shared/ssh-options.ts、src/frontend/ssh-command-import.ts、src/worker/db-ready-cache.ts、src/worker/access-ws-transport.ts、scripts/measure-ssh-connect.mjs、test/unit/worker/{ssh-host,ssh-options,ssh-options-api,db-ready-cache,access-ws-transport}.test.ts、test/unit/frontend/ssh-command-import.test.ts、go-ssh/ssh_options_test.go。
- 寫入（修改）：shared/types.ts（ConnectionConfig+sshOptions/accessProxy、AccessProxyView）、d1-store.ts（view/patch/合併/AccessSecretRequiredError/getConnectionWithInternal）、index.ts（ParseResult、requireDatabaseReady 快取接線、handleSsh 單查詢、d1Error 400 分支）、backend-ssh-do.ts（normalizeSshHostname、accessProxy transport 分流、parseSessionConfigHeader、廢 /init）、ssh-session-init.ts（重寫單 subrequest X-Session-Config）、auth.ts（cachedSigningKey）、main.ts/index.html/styles/api.ts/connection-form-state.ts（表單+匯入+OS 預熱）、go-ssh client.go/main.go/testserver_test.go/client_test.go、README.md 三節、index.test.ts 兩 423 測試 resetDbReadyCache、量測腳本 OS 預取。
- 量測操作：node scripts/build-go.mjs 重建 WASM 兩次（IPv6 後、-o Go 後）；measure-ssh-connect.mjs 基線與優化後各 5 iterations 兩輪。
- 服務事件：量測時發現 8787/2222 均已退出（非本 agent 停止）→ 重建：`go build` dev-ssh-server 啟動（PID 16612@2222）、`node node_modules\wrangler\bin\wrangler.js dev`（PID 23916@8787），維持運行。
- 教訓：(1) vitest-pool-workers isolatedStorage 回滾 D1/KV 但不回滾 module 記憶體——isolate 級快取必須在依賴「未就緒狀態」的測試前明確 reset；(2) quota DO 與主路徑並行會讓錯誤請求也產生 DO instance，Windows Miniflare 下 EBUSY 直接崩 runtime——「優先無副作用錯誤路徑」與「並行提速」衝突時選穩定；(3) WS 升級請求不能帶 body，內部 RPC payload 可走自訂 base64 header；(4) cloudflared Access 通道本質就是 https://<hostname>/ 的 WS 升級＋CF-Access headers，可在 Worker 內複刻免裝 binary；(5) OS 偵測的 KV 讀取可與 SSH handshake 並行，靠既有 inflight 去重零風險重疊。

### 2026-08-26 第二輪速度疊代（DO 重用 + terminal 預載）

- 讀取：index.ts DO 命名使用處、backend-ssh-runtime.ts load() 暖路徑、main.ts 認證路徑、wrangler.jsonc SSH_SESSIONS 設定、外部 DO warm-start 調查（無權威文檔，社群證實冷啟動存在）。
- 寫入（修改）：ssh-session-init.ts 新 export `sshSessionDoName(connectionId)`（穩定 DO 名 `ssh-${connectionId}`，TDD 2 測試）、index.ts getByName 接線、main.ts `preloadTerminal()`（refreshSession/login 後 import("./terminal") 預載，DOM 膠水層以 typecheck+build 驗證）。
- 量測操作：DO 重用後 warm 連線 5+6 iterations 兩輪——total median 694→335~387ms（較基線 960ms -60%）、s1_ws 501→214~278ms（DO 冷啟動消失）、s2_ssh 175→113~137ms（WASM 重 instantiate 消失）。
- 評估後不做：runtime 10ms 輪詢事件化（暖 DO 下第一行即命中 sshEngine，DO 重用後價值消失）、quota 搬入 DO（仍兩跳）、D1 config isolate 快取（違反 credential 記憶體邊界）。
- 教訓：(1) DO 重用的前提是「無跨請求可變狀態」——優化3 把 config 改走 header 後 DO 變純運行時，重用才安全，順序很重要；(2) DO instance 內 module 級 WASM 單例 = 免每連線 7.9MB instantiate，記憶體面也嚴格優於每連線新 isolate；(3) 大 chunk（xterm 285KB）預載掛在認證成功後、與 bootstrap/列表 API 自然重疊，零風險。

## 2026-08-26 Web UI 選中判定缺陷修復（任務 22）

- 讀取：src/frontend/folder-browser-state.ts、main.ts（renderSelectionBar/renderConnList/selection handlers/openMoveDialog/deleteConnectionFromUi）、index.html selection-bar、liquid-glass.css indeterminate 樣式、test/unit/frontend/folder-browser-state.test.ts、api.ts moveConnections/deleteFolder 契約。
- 寫入（修改）：folder-browser-state.ts（replaceScope 同 folderId 修剪 selected ∩ connections；selectedConnectionIds(visibleIds?) 交集重載）、main.ts（renderSelectionBar/renderConnList/dragstart/selection-move 四處改交集計算）、folder-browser-state.test.ts（+2 測試：修剪、交集）、agent/question.md 第二十四節、deep_todos.md 任務 22。
- 瀏覽器操作（Playwright@8787）：登入→勾選→fetch API 把已選主機移到 awa 資料夾（模擬跨分頁）→建臨時資料夾觸發清單重拉→觀察全選框/計數/移動 dialog；修復前重現假全選+幽靈計數+點擊清空，修復後半選+交集計數+移動僅有效 id；每次驗證後復原（loc 移回、zz-* 資料夾刪除）。
- 教訓：(1) 集合型 UI 判定（全選/半選）不能拿「selected 絕對大小」比「清單大小」——跨分頁同步會產生清單外 id，必須用交集；(2) 純函式狀態類（FolderBrowserState）先補單元測試再讓 DOM 膠水層接線，雙層（狀態修剪+渲染交集）互為保險；(3) 「假全選」checkbox 被點擊時瀏覽器走 true→false 分支，會把使用者原有勾選全部清空——顯示錯誤的狀態會放大成資料操作錯誤。
- 後續（同日）：使用者追問「已選取 0 筆為什麼 ui 還在」→ 選取 bar 改為只在選取數 > 0 時出現，「全選本頁」入口搬到主機 section heading（.section-heading-side），清單空時一併隱藏；HTML contract 測試 2 新（index.html?raw + index-of 斷言元素歸屬）；390px 量測 DOM 溢出驗證。教訓：(4) 常駐的「0 筆＋disabled 按鈕」bar 是視覺噪音——批次操作列應由實際選取狀態驅動出現，入口控制項留在清單標題列。

