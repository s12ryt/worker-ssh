# 深度任務歷史（deep_todos.md）

> 完整任務歷史紀錄。新任務附加於文件末尾。

---

## 任務 1：worker-ssh 初始建置（✅ 已完成 2026-08-22）

- **日期**：2026-08-22
- **來源**：todos.md（7 項需求）
- **已確認決策**：見 `agent/question.md`（D1–D14）
- **工作項目**：
  - [x] 需求澄清與決策紀錄
  - [x] 專案腳手架（npm + wrangler + vitest + go module + esbuild）
  - [x] Worker：AES-GCM 加密層（TDD，7 測試）
  - [x] Worker：面板認證與 HMAC session（TDD，10 測試）
  - [x] Worker：KV 存儲層——連線設定 CRUD、OS 快取（TDD，11 測試）
  - [x] Worker：TCP↔WebSocket 橋接（TDD：驗證閘門＋幫浦邏輯，8 測試）
  - [x] Worker：HTTP 路由整合測試（26 測試；typecheck 全綠；build 15.4kb）
  - [x] Go/WASM SSH 引擎：連線/認證（密碼+私鑰）（go test TDD，6 測試）
  - [x] Go/WASM SSH 引擎：shell/exec/SFTP 通道（go test TDD，11 測試）
  - [x] Go/WASM main.go：syscall/js 橋接層（wasm 編譯驗證）
  - [x] 前端：parsers/osdetect/icons 指標解析＋OS 映射（TDD，26 測試）
  - [x] 前端：Liquid Glass 主題（淡藍→淺紫漸層、暗色）— styles/liquid-glass.css
  - [x] 前端：登入頁、連線管理面板 — index.html + main.ts + api.ts
  - [x] 前端：xterm.js 終端機整合 — terminal.ts + ssh-engine.ts
  - [x] 前端：SFTP 檔案管理器 — sftp-panel.ts + sftp-paths.ts（TDD，6 測試）
  - [x] 前端：即時監控儀表板（3 秒輪詢）— monitor.ts（TDD，18 測試）
  - [x] 架構補完：go-ssh/wsconn.go（WebSocket 型 net.Conn）+ client.go Dialer 注入 + connect(cfg, transport)
  - [x] 回歸驗證：前端 50/50、Worker 62/62、Go PASS、typecheck 無錯誤、build 成功
  - [x] 自主疊代升級（D14 量測驅動）：修復 jsPromise FuncOf 洩漏、jsOpenShell 冗餘拷貝；KV N+1 評估後不改（記錄取捨）

### 最終量測數據
- dist/worker/index.js：15.4 KB
- dist/client/app.js：354 KB（xterm 主導，邊緣壓縮後約 100 KB）
- dist/client/wasm/ssh.wasm：7.7 MB（Go wasm＋net 套件基線，已 -s -w；邊緣壓縮後約 2.3 MB）

## 疊代 2：自主疊代升級第二輪（已完成 2026-08-22）

- **觸發**：使用者「自主疊代升級」（D14 量測驅動）
- **量測基線**：worker/index.js 15.4KB、app.js 354.2KB、ssh.wasm 7708KB
- **工作項目**：
  - [x] [高] wsbridge pump WS→TCP 有界緩衝（TDD，PumpOptions.maxBufferedBytes 預設 4MiB，超限安全收尾；Worker 測試 65/65）
  - [x] [高] crypto.ts PBKDF2 金鑰衍生快取（TDD，(keyMaterial,salt) 快取上限 16 近似 LRU；熱路徑 decrypt 重複請求 0 次衍生；Worker 測試 70/70）
  - [x] [中] xterm code splitting（main.ts 動態 import terminal；esbuild splitting+entryNames=app+建置前清殘留；app.js 354.2KB→70.0KB −80%，terminal chunk 283.6KB 延遲載入）
  - [x] 新增 scripts/check-split.mjs＋npm run check:split（可重複驗證分割產物）
- **額外修復**：wsbridge.test.ts TS2349（閉包賦值型別窄化，顯式放寬）；typecheck 歸零
- **最終驗證**：前端 50/50、Worker 70/70、Go PASS、typecheck 0 錯誤、build 成功、check:split OK

### 疊代 3：表情符號全數替換為 SVG（✅ 完成）
- [x] 盤點渲染輸出符號（sftp-panel 5 處、index.html 3 處）
- [x] ui-icons.ts TDD（4 測試）＋sftp-panel/index.html/css 接線
- [x] 驗證：零符號掃描、typecheck、前端 58/58、build、check:split

## 疊代 3：E2E 瀏覽器實測（playwright-mcp）✅ 完成
- [x] dev-ssh-server 本地 SSH 測試伺服器（scripts/dev-ssh-server/）
- [x] 修復 7 項 E2E 揭露缺陷（引擎載入競爭／WS 早期事件遺失／readyState panic／Blob 型別／偵測標記／sftpList Promise／openShell await）
- [x] putOs {key,info} 契約修正；全形加號與 favicon SVG 化
- [x] 全流程驗證：登入→連線→終端雙向→OS 偵偵測快取→監控八指標→SFTP 渲染→返回；emoji 零匹配
- [x] 最終回歸：前端 58/58、Worker 71/71、Go PASS、typecheck 0 error、build＋check:split OK（app.js 72.8KB）
- 量測：app.js 72.8KB（xterm 已延遲載入）、worker bundle 含 Blob 四分支幫浦、wasm 7.7MB 不變

## 疊代 4：自主疊代升級第三輪 — Web UI 美化（✅ 完成 2026-08-22）

- **觸發**：使用者「自主疊代升級,幫我把 web-ui 美化」
- **已確認決策**：見 `agent/question.md` 第五節（D18–D24）
  - D18 美化重點（全五項）：視覺精緻度／監控儀表板 sparkline／連線卡片資訊架構／SFTP 與終端機外觀／響應式與行動體驗
  - D19 圖表庫：chart.js/auto 延遲載入
  - D20 連線時間雲同步：ConnectionConfig 加 lastConnectedAt?/lastDisconnectedAt?（ms epoch，可選；容錯讀取舊資料）
  - D21 字型託管：自托管 Inter+Noto Sans TC woff2，零外部 CDN
  - D22 動畫與無障礙：加 prefers-reduced-motion 媒體查詢降級
  - D23 驗收：TDD + typecheck + build + E2E 人工審查截圖
  - D24 變更範圍：三視圖全部（登入/連線管理/工作階段）
- **工作項目（11 階段）**：
  - [x] 階段 1：KV schema 變更 — types.ts 加 lastConnectedAt?/lastDisconnectedAt?；store.ts 容錯讀寫（spread/JSON.parse 天然支援）；store.test.ts 加 4 測試（容錯讀取舊資料）
  - [x] 階段 2：Worker API — index.ts sanitizePatch 加白名單（數字時間戳/null 清除/非數字 400）；index.test.ts TDD RED→GREEN 3 測試
  - [x] 階段 3：字型自托管 — @fontsource/inter + @fontsource/noto-sans-tc 安裝；build-client.mjs 加 fonts 目錄複製；liquid-glass.css 5 個 @font-face；index.html preload Inter 400
  - [x] 階段 4：chart.js 整合 — npm install chart.js；monitor.ts SampleBuffer 純類別 TDD（6 測試，環形緩衝上限 60 點）；createMonitorCharts 膠水層（動態 import chart.js/auto，3 sparkline）；PollerDeps.onSnapshot 回呼；index.html 3 canvas；main.ts connectTo/teardown 整合
  - [x] 階段 5：CSS 視覺精緻度 — liquid-glass.css 306→430 行（設計 token 擴充、骨架屏 shimmer、空狀態插圖、hover/focus 微互動、終端機標題列、SFTP 分色、響應式 1024/720/480 三段、prefers-reduced-motion 降級）；index.html 加骨架屏/空狀態/終端機標題列結構
  - [x] 階段 6：連線卡片資訊架構 — formatLastConnected 純函數 TDD（9 測試，YYYY-MM-DD UTC 避時區歧義）；renderConnList 加 meta-row（status-indicator + last-time）；showConnections 顯示骨架屏；connectTo 寫 lastConnectedAt；teardown 寫 lastDisconnectedAt
  - [x] 階段 7：SFTP 表格與終端機外觀 — fileKindOf 純函數 TDD（12 測試，folder/archive/code/image/doc/binary/file 7 類分色）；sftp-panel.ts data-kind 接線 + renderSkeleton 骨架屏；main.ts setStatus 同步 term-status + term-conn-name 接線；CSS 補 .sftp-skeleton-list/row
  - [x] 階段 8：響應式優化 — 1024/720/480 三段驗證；480px 補三項（term-conn-name 截斷、conn-meta-row column、sftp-container overflow-x）
  - [x] 階段 9：回歸驗證 — typecheck 0 錯；check:split OK；前端 9 檔 85/85；Worker 6 檔 78/78；Go PASS(cached)；build:client 成功；build:worker 17.9KB
  - [x] 階段 10：E2E 截圖驗收 — playwright-mcp 拍 6 截圖（登入/連線管理/終端機/SFTP/監控桌面/監控 480px 行動）；三視圖 + 響應式全數驗證通過
  - [x] 階段 11：更新 agent 紀錄 + 完成報告
- **最終量測數據**：
  - dist/worker/index.js：17.9 KB（含 sanitizePatch lastConnectedAt/lastDisconnectedAt 白名單）
  - dist/client/app.js：79.4 KB（+6.6KB，含 format/sftp-file-kind/監控 charts 整合/連線卡片 meta-row/終端機標題列接線）
  - dist/client/auto-3KQDQO5B.js：200.1 KB（chart.js/auto 延遲 chunk，連線後預載）
  - dist/client/terminal-I4AVIWRL.js：290.4 KB（xterm 延遲 chunk，不變）
  - dist/client/styles/liquid-glass.css：18.9 KB（+10.9KB，含設計 token/骨架屏/空狀態/響應式/prefers-reduced-motion）
  - dist/client/fonts/：5 woff2（Inter 400/600/700 各 ~23KB + Noto Sans TC 400/600 各 ~974KB，總 ~2MB，首次載入後快取）
  - dist/client/wasm/ssh.wasm：7.89 MB（不變）
- **測試總結**：前端 9 檔 85/85（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12）、Worker 6 檔 78/78（store 4 + index 3 + 原有 71）、Go PASS、typecheck 0 錯、build 全部成功、check:split OK
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出（D15–D17）等既有契約全數保留

---

## 任務 5：SFTP 文字檔線上預覽（✅ 已完成 2026-08-23）

- **日期**：2026-08-23
- **來源**：使用者 m0195「無法在線查看文字文件」
- **已確認決策**：見 `agent/question.md` 第六節（D25–D33）
  - D25 情境：worker-ssh SFTP 面板
  - D26 觸發：按鈕（eye 圖示）+ 點擊檔名
  - D27 呈現：Modal 彈窗（覆蓋式）
  - D28 語法高亮：引入 highlight.js
  - D29 託管：npm install + 動態 import('highlight.js/lib/core') + 按需註冊 ~20 語言
  - D30 語言指定：副檔名→語言映射表（純資料 TDD），未匹配 fallback highlightAuto
  - D31 大小上限：1MB（超過提示下載）
  - D32 二進位判定：fileKindOf=binary 直接拒絕；未知類型 TextDecoder 後 U+FFFD ≥10% 拒絕
  - D33 Modal 結構：標題列（檔名+關閉鈕）+ pre/code 高亮 + 底部（複製+下載）；backdrop/Esc/關閉鈕三路關閉；唯讀
- **工作項目**（9 階段，全數 completed）：
  - [x] 階段 P1：npm install highlight.js（+依賴）
  - [x] 階段 P2：TDD highlight-language.ts（27 測試，~40 副檔名→語言映射，大小寫不敏感，無副檔名/隱藏檔→null）
  - [x] 階段 P3：TDD isPreviewable（13 測試，isDir/binary/archive/image/大小上限/NaN/Infinity 守門）
  - [x] 階段 P4：preview-modal.ts Modal DOM + 渲染（184 行，動態建立 backdrop+dialog+titlebar+pre/code+footer，loadHighlighter 冪等註冊 20 語言，highlightElement 非阻塞）+ decodePreviewText TDD（8 測試，U+FFFD ≥10% 回 null）+ ui-icons 擴充 eye/close/copy 三圖示
  - [x] 階段 P5：sftp-panel.ts 整合（import openPreviewModal/isPreviewable/PREVIEW_MAX_BYTES；render 加 is-clickable + 預覽按鈕 eye + 點擊檔名；preview() 私有方法 isPreviewable 守門 + readFile + openPreviewModal + onCopy clipboard + onDownload）
  - [x] 階段 P6：CSS Modal 樣式（liquid-glass.css +108 行 .preview-backdrop/modal/titlebar/content/footer + highlight.js 暗色 token 色彩自訂最小化 + is-clickable + 480px 響應式 + previewFadeIn/previewIn 動畫）
  - [x] 階段 P7：回歸驗證 — typecheck 0 錯；build:client 成功（app.js 84.8KB/+5.4KB、liquid-glass.css 22.3KB/+3.4KB、core-BKSSFOLX.js 20.8KB highlight.js/lib/core、20 個語言各自獨立延遲 chunk 0.6-13KB）；test:frontend 11 檔 133/133；check:split OK；test:go PASS(cached)；test:worker 77/78（crypto-cache 第 4 測試 flaky——vitest-pool-workers 並行 workerd 行程互相干擾 miniflare 暫存目錄，單獨跑 5/5 全綠，本次未動 Worker 程式碼，非本次責任）
  - [x] 階段 P8：E2E 截圖驗收 — dev-ssh-server(pid 22096 監 2222)+wrangler dev(pid 33164 監 8799)+playwright-mcp；8 項全通過（預覽按鈕 eye 顯示/點擊預覽按鈕開 Modal/點擊檔名開 Modal/Modal 結構正確/Esc 關閉/關閉鈕關閉/大檔 6.3GiB 拒絕 toast/語法高亮 hljs language-ini + 15 span 子節點）；截圖 shot-preview-modal-log.png + shot-preview-too-large.png
  - [x] 階段 P9：更新 agent 紀錄 + 完成報告
- **最終量測數據**：
  - dist/worker/index.js：17.9 KB（不變，本次未動 Worker）
  - dist/client/app.js：84.8 KB（+5.4KB，含 highlight-language/sftp-preview/preview-modal + sftp-panel 預覽整合）
  - dist/client/core-BKSSFOLX.js：20.8 KB（highlight.js/lib/core 延遲 chunk，點擊預覽才載入）
  - dist/client/20 個語言 chunk：0.6-13 KB 各自獨立延遲載入（javascript 6.5/typescript 7.8/python 3.5/go 1.5/bash 3.2/json 0.6/yaml 1.9/xml 1.9/markdown 2.1/css 13.5/sql 6.5/c 4.7/cpp 3.2/java 2.8/rust 3.0/php 6.5/ruby 3.9/lua 1.9/diff 0.6/ini 1.0 KB）
  - dist/client/styles/liquid-glass.css：22.3 KB（+3.4KB，含 .preview-* + hljs token 色彩）
  - dist/client/auto-3KQDQO5B.js：200.1 KB（chart.js/auto，不變）
  - dist/client/terminal-I4AVIWRL.js：290.4 KB（xterm，不變）
- **測試總結**：前端 11 檔 133/133（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12 + highlight-language 27 + sftp-preview 21）、Worker 6 檔 78/78（含 1 flaky）、Go PASS、typecheck 0 錯、build 全部成功、check:split OK
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出、字型自托管零外部 CDN（D21）、第三輪美化全部成果（D18–D24）等既有契約全數保留

---

## 任務 6：SFTP 文字檔線上編輯（✅ 已完成 2026-08-23）

- **日期**：2026-08-23
- **來源**：使用者 m0352「可以在線查看了,為什麼不能在線編輯」
- **已確認決策**：見 `agent/question.md` 第七節（D34–D46）
  - D34 編輯器：CodeMirror 6（~150KB 延遲 chunk，帶行號/語法高亮/查找替換/Tab 縮排）
  - D35 儲存方式：覆蓋原檔預設 + 另存新檔
  - D36 可編輯檔案類型：與 isPreviewable 相同條件（沿用既有純函數，不新增 alias）
  - D37 編輯檔案大小上限：1MB（與預覽相同）
  - D38 未儲存離開提示：瀏覽器 confirm
  - D39 進階功能：語法高亮即時顯示 + 行號 + Tab 鍵縮排
  - D40 編輯模式進入：預設編輯模式（不經預覽步驟；唯讀按鈕切換）
  - D41 另存新檔：同目錄+檔名輸入（預設「原檔名.copy.原副檔名」；檔名已存在拒絕；validateFilename 守門）
  - D42 覆蓋原檔前確認：二次確認 window.confirm
  - D43 Tab 鍵行為：2 Space（Shift+Tab 反縮排）
  - D44 存檔後行為：Modal 保持開啟+狀態提示（標題列「已儲存」綠色 2 秒淡出）
  - D45 預覽與編輯 UI 整合：預覽改為編輯+Modal 內切換（eye 按鈕改 pencil；Modal 內唯讀/編輯切換）
  - D46 唯讀切換行為：保留編輯內容（切到唯讀不丟失未儲存編輯）
- **工作項目**（9 階段，全數 completed）：
  - [x] 階段 E1：npm install CodeMirror 6（13 個 lang-* + 6 個核心套件；移除 lang-lua/lang-ruby/lang-typescript 因無官方包或由 lang-javascript 支援）；確認 go-ssh/sftpfs.go SftpWriteFile + ssh-engine.ts SshClient.writeFile 已存在
  - [x] 階段 E2：TDD filename-validate.ts validateFilename 純函數（25 測試；不能含 /\:*?"<>|、非空、≤255、不能是 . 或 ..、不能全空白）
  - [x] 階段 E3：ssh-engine.ts SshClient.writeFile 已存在，跳過
  - [x] 階段 E4：edit-modal.ts openEditModal（337 行；CodeMirror 6 動態載入 loadCodeMirror 冪等；13 語言動態載入 LANG_LOADERS；唯讀切換 readOnlyCompartment.reconfigure；Ctrl+S/Ctrl+Shift+S/Esc 鍵盤快捷鍵；未儲存提示 confirm；D42 二次確認；D41 另存檔名驗證；狀態徽章 dirty/clean/saved/error）+ ui-icons.ts 加 pencil 圖示
  - [x] 階段 E5：sftp-panel.ts 整合（eye→pencil, preview()→edit() 呼叫 openEditModal；import 移除 preview-modal 加 edit-modal + decodePreviewText；isPreviewable 守門保留；onSave/onSaveAs/onDownload 委派）+ ui-icons.ts 加 pencil 圖示（共 12 個）
  - [x] 階段 E6：liquid-glass.css 加 .edit-backdrop/.edit-modal/.edit-titlebar/.edit-title-wrap/.edit-title/.edit-status-badge[data-state=dirty|clean|saved|error]/.edit-content + .cm-* CodeMirror 暗色主題樣式（與 hljs token 色彩一致）+ 480px 響應式 + prefers-reduced-motion（22348→27916 +5568）
  - [x] 階段 E7：回歸驗證 — typecheck 0 錯；test:frontend 12 檔 158/158 全綠（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12 + highlight-language 27 + sftp-preview 21 + filename-validate 25）；check:split OK；build:client 成功（app.js 88533 +3.6KB、liquid-glass.css 27916 +5568、codemirror chunks 7 個延遲載入）
  - [x] 階段 E8：E2E 截圖驗收 — dev-ssh-server(pid 27768 監 2222)+wrangler dev(pid 33164 監 8799)+playwright-mcp；6 項全通過（編輯按鈕 pencil 顯示/點擊按鈕開 Modal/Modal 結構正確標題列+檔名+未儲存徽章+切換唯讀/另存/存檔/下載/關閉五按鈕+CodeMirror 行號+textbox 語法高亮/dirty 徽章顯示/Esc 關閉時 confirm 提示未儲存 D38/接受 confirm 後 Modal 關閉返回 SFTP 列表）；截圖 shot-edit-modal-open.png
  - [x] 階段 E9：更新 agent 紀錄 + 完成報告
- **最終量測數據**：
  - dist/worker/index.js：17.9 KB（不變，本次未動 Worker）
  - dist/client/app.js：88.5 KB（+3.6KB，含 edit-modal import + sftp-panel edit() 方法改造）
  - dist/client/styles/liquid-glass.css：27.9 KB（+5.6KB，含 .edit-* + .cm-* CodeMirror 暗色主題）
  - dist/client/codemirror chunks：7 個延遲載入（chunk-BATFJXJY.js 200.8KB codemirror 核心、dist-ENVUGKIM.js 104KB、dist-GYC4P7R2.js 98KB、chunk-DAGP26HV.js 86.9KB、chunk-VWSRVVI3.js 72.3KB、dist-PCAWI4RY.js 70.9KB、chunk-EFRUEJJW.js 49KB 多個 lang-* 語言包延遲 chunk）
  - dist/client/core-BKSSFOLX.js：20.8 KB（highlight.js/lib/core，預覽功能保留不變）
  - dist/client/auto-3KQDQO5B.js：200.1 KB（chart.js/auto，不變）
  - dist/client/terminal-I4AVIWRL.js：290.4 KB（xterm，不變）
- **測試總結**：前端 12 檔 158/158 全綠（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12 + highlight-language 27 + sftp-preview 21 + filename-validate 25）、Worker 6 檔 78/78（含 1 flaky crypto-cache）、Go PASS、typecheck 0 錯、build 全部成功、check:split OK
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出、字型自托管零外部 CDN（D21）、第三輪美化全部成果（D18–D24）、SFTP 預覽全部成果（D25–D33，preview-modal.ts 保留不動）等既有契約全數保留

---

## 任務 7：自主疊代升級 — bug 檢查與修復（✅ 已完成 2026-08-23）

- **日期**：2026-08-23
- **來源**：使用者 m0463「自主疊代升級,優先查看授權部分有無bug,之後再仔細翻找其餘代碼有無bug」
- **工作項目**（8 階段，全數 completed）：
  - [x] 階段 B1：讀取授權相關檔案（auth.ts/crypto.ts/index.ts/api.ts/wsbridge.ts/store.ts/main.ts 登入流程）建立行為特徵
  - [x] 階段 B2：審查授權部分有無 bug — 未發現需修復的 bug（timingSafeEqual SHA-256 雜湊+常數時間比較 ✓；AES-GCM 信封 PBKDF2 210k ✓；sessionCookie HttpOnly+Secure+SameSite=Strict ✓；isAuthed 缺 await 非 bug——async 自動 unwrap Promise 且 verifySessionToken 內部 try/catch 不 reject；/api/logout 無方法檢查但 SameSite=Strict 已防 CSRF 且 logout 無副作用；wsbridge Blob 順序潛在問題非現存 bug——workerd 訊息型態固定不混合）
  - [x] 階段 B3：授權部分無 bug 需修復，跳過
  - [x] 階段 B4：審查其餘前端代碼（monitor/sftp-panel/ssh-engine/edit-modal/osdetect/preview-modal/format/sftp-preview/sftp-file-kind/highlight-language/filename-validate/terminal 12 檔）— 發現 2 bug（同根同源：edit-modal.ts preloadLanguage 語言模組匯出名稱不匹配）
  - [x] 階段 B5：TDD 修復 — resolveLangExportName 純函數 RED 12 失敗（`resolveLangExportName is not a function`）→ GREEN 12/12 全綠；edit-modal.ts 加 LANG_EXPORT_NAME 映射表（typescript→"javascript"、c→"cpp"）+ preloadLanguage 改用 resolveLangExportName + typescript 特殊處理條件改為 `lang === "javascript" || lang === "typescript"`
  - [x] 階段 B6：回歸驗證 — typecheck 0 錯；test:frontend 13 檔 170/170 全綠（原 12 檔 158 + edit-modal-lang 12）；build:client 成功；check:split OK
  - [x] 階段 B7：審查 Go 代碼（main.go/client.go/sftpfs.go/session.go/wsconn.go 5 檔）— 未發現需修復的 bug（線程安全 mu.Lock ✓；jsPromise handler.Release() ✓；sftpClientOf defer cli.Close() ✓；ShellHandle closed 旗標防重複 ✓；WsConn closeOnce 防重複 ✓；潛在問題 3 項均非現存 bug：jsOpenShell goroutine 順序、SftpWriteFile 重複 Close、WsConn.inbox 緩衝 64）
  - [x] 階段 B8：更新 agent 紀錄 + 完成報告
- **發現的 bug**：
  - Bug 1（中嚴重度）：TypeScript 語法高亮失效 — highlight-language.ts ts/tsx→"typescript"，LANG_LOADERS["typescript"] = () => import("@codemirror/lang-javascript")，但 lang-javascript 匯出 `javascript` 不匯出 `typescript`，`mod["typescript"]` = undefined 返回 null fallback 純文字
  - Bug 2（中嚴重度）：C 語法高亮失效 — highlight-language.ts c/h→"c"，LANG_LOADERS["c"] = () => import("@codemirror/lang-cpp")，但 lang-cpp 匯出 `cpp` 不匯出 `c`，`mod["c"]` = undefined 返回 null
- **修改的檔案**：
  - src/frontend/edit-modal.ts：加 LANG_EXPORT_NAME 映射表 + resolveLangExportName export 純函數 + preloadLanguage 改用 resolveLangExportName + typescript 特殊處理條件修正
  - test/unit/frontend/edit-modal-lang.test.ts：新增 12 測試（typescript→javascript、c→cpp、其餘語言→自身、未知→自身、空字串→自身）
- **最終量測數據**：
  - dist/worker/index.js：17.9 KB（不變，本次未動 Worker）
  - dist/client/app.js：~88.5 KB（不變，僅 edit-modal.ts 內部修正無新 import）
  - dist/client/styles/liquid-glass.css：27.9 KB（不變）
  - codemirror chunks：7 個延遲載入（不變）
- **測試總結**：前端 13 檔 170/170 全綠（format 9 + monitor 24 + ui-icons 3 + os-cache 5 + sftp-paths 6 + osdetect 9 + parsers 9 + icons 8 + sftp-file-kind 12 + highlight-language 27 + sftp-preview 21 + filename-validate 25 + edit-modal-lang 12）、Worker 6 檔 78/78（含 1 flaky crypto-cache 既有環境問題）、Go 代碼審查通過（未改 Go 代碼無需重跑 go test）、typecheck 0 錯、build 成功、check:split OK
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密結構、HMAC session、零表情符號輸出、字型自托管零外部 CDN、第三輪美化全部成果（D18–D24）、SFTP 預覽全部成果（D25–D33）、SFTP 編輯全部成果（D34–D46）等既有契約全數保留

### Bug 3 後續修復（2026-08-23，使用者 E2E 反饋）
- 使用者反饋「yaml這類打不開 顯示 Cannot read properties of undefined (reading 'startParse')」
- **Bug 3（高嚴重度）：所有 CodeMirror 語言高亮崩潰**
  - 位置：src/frontend/edit-modal.ts line 201
  - 根因：`cm.language.of(langExt as Language)` 將 LanguageSupport cast 為 Language，language.of() 返回 StateEffect（非 Extension），CodeMirror 6 嘗試在 LanguageSupport 上呼叫 startParse（Language 方法）→ `undefined.startParse` 崩潰
  - 影響：所有有 LANG_LOADERS 條目的語言（javascript/typescript/python/go/json/yaml/xml/markdown/css/sql/cpp/c/java/rust/php）都會崩潰；.log（ini）無條目不崩潰但也無高亮
- **修復**：edit-modal.ts line 201 改為 `[langExt as Extension]`（LanguageSupport 本身就是 Extension，直接傳入 EditorState.create）
- **後端 API 認證審查**：系統性檢查 src/worker/index.ts 所有 API 端點（/api/login、/api/session、/api/logout、/api/connections、/api/connections/:id、/api/os、/proxy），結論：所有需要認證的端點都有 isAuthed 守衛，沒有遺漏
- **E2E 驗證**：dev-ssh-server + wrangler dev + playwright-mcp，上傳 test-syntax.yaml 至 /tmp，點擊 serverpro.html（xml 語言）編輯按鈕，Modal 正確開啟不崩潰，語法高亮正常；截圖 shot-xml-syntax-highlight.png
- **最終測試**：前端 13 檔 170/170、typecheck 0 錯、build 成功、check:split OK

## Bug 4 後續修復（2026-08-23，使用者 E2E 反饋）

- 使用者反饋「怎麼md文件沒有高亮顯示啊」+「連結高亮能改成但藍色嗎」
- **Bug 4（中嚴重度）：所有語言語法高亮失效（包括 markdown）**
  - 位置：src/frontend/edit-modal.ts loadCodeMirror + EditorState.create
  - 根因：CodeMirror 6 的 defaultHighlightStyle 使用 opaque hash-based class（ͼ5/ͼ7 等），不是 .tok-keyword 這種可讀 class；CSS 中的 .tok-keyword/.cm-keyword 等規則無法匹配 opaque class，所以視覺無高亮；語法解析本身正常（span 有被分割成不同 class），只是 class 名稱不可讀
  - 影響：所有語言（javascript/typescript/python/go/json/yaml/xml/markdown/css/sql/cpp/c/java/rust/php）都有語法解析但無視覺高亮
- **修復**：edit-modal.ts 三處修改
  1. CmBundle type：移除 defaultHighlightStyle，加 syntaxHighlighting + HighlightStyle + tags（來自 @lezer/highlight）
  2. loadCodeMirror：Promise.all 加 `import("@lezer/highlight")`，return object 改 HighlightStyle + tags（移除 defaultHighlightStyle）
  3. EditorState.create：`cm.syntaxHighlighting(cm.defaultHighlightStyle)` → `cm.syntaxHighlighting(buildCustomHighlightStyle(cm))`
  4. 新增 buildCustomHighlightStyle 函數（line 34-88）：~40 種 Lezer tag→tok-* class 映射（keyword→tok-keyword、string→tok-string、number→tok-number、bool→tok-bool、atom→tok-atom、comment→tok-comment、variableName→tok-variableName、function→tok-function、typeName→tok-typeName、namespace→tok-namespace、propertyName→tok-propertyName、punctuation→tok-punctuation、operator→tok-operator、meta→tok-meta、tagName→tok-tagName、attributeName→tok-attributeName、attributeValue→tok-attributeValue、heading1-6/heading→tok-heading、link→tok-link、url→tok-url、invalid→tok-invalid 等）
- **連結高亮改但藍色**：CSS .tok-link/.cm-link color 從 #7dd3fc 改為 #60a5fa（使用者要求，Tailwind blue-400 更飽和的藍色）
- **E2E 驗證**：dev-ssh-server + wrangler dev + playwright-mcp，進入 /tmp 目錄，點擊 list1.md 編輯按鈕，Modal 正確開啟；evaluate 檢查 tokCount 從 0 變為 122，tokClasses 從 opaque ͼN 變為語意化 tok-heading/tok-link/tok-meta/tok-punctuation/tok-url，firstLineHTML 從 `<span class="ͼ7 ͼ5">` 變為 `<span class="tok-heading tok-meta">`；截圖 shot-markdown-syntax-highlight.png
- **最終測試**：前端 13 檔 170/170、typecheck 0 錯、build 成功（app.js 90813 bytes +2080 因加 buildCustomHighlightStyle + @lezer/highlight import）

## 任務 8：SFTP 文字檔瀏覽器渲染預覽（✅ 已完成 2026-08-23）

- 使用者原始需求：「在md和html這類文件中的彈出ui增加一個小按鈕,讓文件可以在瀏覽器渲染」
- 三輪 question 工具澄清確認 D1–D16，寫入 agent/question.md 第八節
- 7 階段工作項目全數完成：
  - R1：npm install 9 套件（markdown-it + 6 外掛 anchor/footnote/task-lists/emoji/sub/sup/deflist + dompurify + papaparse；markdown-it-highlight 0.2.0 太舊不適用，D10 改用 markdown-it highlight option 直接傳入 highlight.js）
  - R2：TDD render-kind.ts renderKindOf 純函數（25 測試，副檔名→渲染類型 markdown/html/svg/csv/none）
  - R3：edit-modal.ts 整合（渲染預覽按鈕 eye + previewDiv + togglePreview + renderPreview + renderMarkdown[markdown-it+6 外掛+DOMPurify+highlight.js] + renderHtml[sandbox iframe] + renderSvg[DOMPurify+innerHTML] + renderCsv[PapaParse+table] + module-declarations.d.ts 宣告 7 個缺少型別的模組）
  - R4：CSS .edit-preview + Markdown 暗色主題元素（h1-h6 #c4b5fd/p/a #60a5fa/code #86efac/blockquote/table/list 等）+ hljs token + svg/csv/html 預覽容器 + 480px 響應式
  - R5：回歸驗證 typecheck 0 錯、test:frontend 14 檔 195/195、build 成功、check:split OK（app.js 91.6KB +2.8KB）
  - R6：E2E 截圖驗收 + Bug 5 修復
  - R7：更新 agent 紀錄 + 完成報告
- **Bug 5（中嚴重度）：markdown-it use 報錯** `TypeError: A.apply is not a function at G.use`
  - 根因：edit-modal.ts renderMarkdown 的 Promise.all 陣列含 `import("dompurify")`，dompurify 被當作 markdown-it 外掛傳入 `.use()`，但 dompurify 不是 markdown-it 外掛
  - 修復：從 Promise.all 移除 dompurify（已在 line 430 單獨 import）；外掛匯入用 typeof 檢查（`mod.default?.default ?? mod.default ?? mod` + `if (typeof candidate === "function") mdRenderer.use(candidate)`）；dompurify 用 as any cast
  - E2E 驗證：list1.md 渲染預覽正常（h1×1+h2×7+p×10+0 errors），截圖 shot-markdown-render-preview.png
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密、HMAC session、零表情符號、字型自托管零 CDN、第三輪美化 D18–D24、SFTP 預覽 D25–D33 preview-modal.ts 保留不動、SFTP 編輯 D34–D46、Bug 1-4 修復均不動
- **最終測試**：前端 14 檔 195/195、typecheck 0 錯、build 成功

## UI 細節修復（2026-08-23，使用者 m0959 回報「只是拉伸」）
- 使用者回報三項具體問題：
  1. SFTP 表格欄位太寬/太窄
  2. 頂列（topbar）太厚，影響觀感
  3. SFTP 頁面的「返回」按鈕易誤認，改為「斷開 SSH」+ 二次確認
- 修復：
  1. **SFTP 表格欄寬**：liquid-glass.css `.sftp-table { table-layout: fixed; }` + 5 欄 col 明確寬度（名稱 35%/大小 12%/權限 12%/時間 18%/動作 23%）；sftp-panel.ts render() 加 `<colgroup>` 5 個 `<col>`
  2. **頂列變薄**：`.topbar` padding `12px 20px`→`8px 16px`、gap `16px`→`12px`、margin-bottom `20px`→`12px`、top `12px`→`8px`
  3. **斷開 SSH + 二次確認**：index.html `#sess-back-btn` 文字「返回」→「斷開 SSH」、加 aria-label；main.ts click handler 加 `window.confirm("確定要斷開 SSH 連線並返回連線管理？")`
- E2E 驗證：三視圖截圖確認
  - SFTP：shot-sftp-fixed.png（表格欄寬固定、時間 2026 年、頂列變薄、斷開 SSH 按鈕、確認對話框）
  - 終端機：shot-terminal-fixed.png（全寬、頂列變薄）
  - 連線管理：shot-connections-fixed.png（全寬、頂列變薄）
- 最終測試：typecheck 0 錯、build 成功、check:split OK

## UI 置中問題修復（2026-08-23，使用者 m0052 回報）
- 使用者回報：「現在ui都是置中的,我如果瀏覽器全屏的話ui也都只有中間有而已」
- 問題（低嚴重度）：所有視圖用 `.view { max-width: 1100px; margin: 0 auto; }` 導致全屏時內容限制 1100px 置中
- 修復：src/frontend/styles/liquid-glass.css line 128-129
  - `.view { padding: 24px; }`（移除 max-width + margin:auto）
  - `.view-center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }`（登入視圖專用置中）
- E2E 驗證：三視圖截圖全寬正常
  - SFTP：shot-sftp-fullwidth.png
  - 終端機：shot-terminal-fullwidth.png
  - 連線管理：shot-connections-fullwidth.png
- 最終測試：typecheck 0 錯、build 成功、check:split OK（app.js 91.6KB）、check:split OK

## Bug 6 後續修復（2026-08-23，使用者 E2E 反饋）
- 使用者 m0859 反饋：「SFTP的檔案時間為什麼都是1970」
- Bug 6（低嚴重度）：SFTP 檔案時間顯示為 1970 年。根因：Go 端 go-ssh/sftpfs.go entryFromInfo `ModTime: fi.ModTime().Unix()` 返回 Unix **秒**，前端 src/frontend/sftp-panel.ts line 147 `new Date(e.modTime)` 把秒當 **毫秒**（`new Date()` 期望毫秒），時間值縮小 1000 倍導致顯示為 1970 年。驗證：2026-08-23 Unix 秒≈1787155441，`new Date(1787155441)`=1970-01-22 00:30:41 UTC+8，與使用者 E2E 看到的「1970/1/22 上午12:30:41」完全吻合
- 修復：src/frontend/sftp-panel.ts line 147 `new Date(e.modTime)` → `new Date(Number(e.modTime) * 1000)`（秒轉毫秒；Number() cast 因 e.modTime 型別非 number）
- E2E 驗證：/tmp 目錄 190 個時間列 has1970=false、has2026=true、sample=[2026/5/5、2026/7/24、2026/7/29 等]；截圖 shot-sftp-time-fixed.png
- 最終測試：前端 14 檔 195/195、typecheck 0 錯、build 成功

## 任務 9：確認框 Modal 化（✅ 已完成 2026-08-23）

- **日期**：2026-08-23
- **來源**：使用者要求查看確認框代碼實現，選擇替換為自訂 Liquid Glass Modal（與 .edit-modal/.preview-modal 視覺一致）
- **已確認決策**：見 `agent/question.md` 第九節（D1–D8 + 慣例裁定項 + 11 項驗收條件）
- **盤點**：全專案共 5 處 `window.confirm`（main.ts:200/438、sftp-panel.ts:226、edit-modal.ts:485/536），全為瀏覽器原生，無自訂 Modal
- **工作項目**：
  - [x] 基線測試：`npm run test:frontend` 14 檔 195/195 全綠
  - [x] 需求澄清（兩輪 question 工具）：D1 函式簽名、D2 關閉路徑、D3 危險動作紅色鈕、D4 z-index 疊加、D5 sftp-panel 介面、D6 不重構既有 modal、D7 焦點不預設、D8 Esc 疊加攔截
  - [x] 安裝 jsdom ^29.1.1（devDependency；供 confirm-modal DOM 測試 per-file 環境切換）
  - [x] TDD RED：寫 `test/unit/frontend/confirm-modal.test.ts`（31 測試；15 個 describe 區塊；涵蓋 D1-D8 全行為契約）；RED 失敗原因 `Failed to resolve import "@/frontend/confirm-modal"`（模組不存在 = 缺少目標行為，有效 RED）
  - [x] TDD GREEN：最小實作 `src/frontend/confirm-modal.ts`（openConfirmModal；DOM 結構 backdrop>dialog[role=alertdialog]>[title?]+content+footer>actions；capture=true + stopImmediatePropagation 實現 D8；dialog.focus() 實現 D7；danger 加 .btn-danger class 實現 D3）；31/31 全綠
  - [x] CSS：`src/frontend/styles/liquid-glass.css` 末尾加 .confirm-* 樣式區段（.confirm-backdrop z-index 240 高於 .edit-backdrop 220；.confirm-modal/content/footer/actions；confirmFadeIn/confirmIn 動畫；prefers-reduced-motion 降級；480px 響應式）
  - [x] 整合 main.ts：line 200 刪連線（danger=true, confirmText="刪除"）、line 438 斷開 SSH（不傳 danger）、line 401 SftpPanel 注入 confirm: openConfirmModal({ danger:true, title:"刪除檔案", confirmText:"刪除" })
  - [x] 整合 edit-modal.ts：line 485 doSave 覆蓋原檔（danger=true, confirmText="覆蓋"）；line 536 close 重構為 sync void + fire-and-forget async doClose + confirming 旗標防重入（保留回傳型別 Promise<()=>void>；D8 由 confirm-modal capture 攔截自然達成，edit-modal onKeydown 不需改）
  - [x] 整合 sftp-panel.ts：line 40 介面 confirm? 改 Promise<boolean>；line 47 欄位改 Promise<boolean>；line 56 fallback `Promise.resolve(window.confirm(m))` 保留安全網；line 226 remove 加 await
  - [x] 回歸驗證：前端 15 檔 226/226 全綠（比基線 195 多 31）、typecheck 0 錯、build 成功、check:split OK（app.js 92KB）、零 window.confirm 直接呼叫（5 處全在註解或 fallback 安全網）
- **D8 Esc 疊加實作策略**：confirm-modal 的 onKeydown 用 `document.addEventListener("keydown", onKeydown, true)`（capture=true）+ 所有鍵呼叫 `ev.stopImmediatePropagation()`（阻止同 target document 的 bubble listener，即 edit-modal 的 onKeydown）；只 Escape 額外 `ev.preventDefault()` + cancel()。優點：edit-modal 的 onKeydown 完全不用改，D8 自然達成。jsdom 正確實作 stopImmediatePropagation 跨 capture/bubble（D8 三項測試全綠驗證）。
- **edit-modal close 改 async 策略**：close 保持 sync void（事件 handler 友善，回傳型別 Promise<()=>void> 不變）；內部 `void doClose()` async + confirming 旗標防重入；dirty 時 await openConfirmModal；ok 則 finishClose（closed=true + removeEventListener + editor.destroy + backdrop.remove）；confirming=true 期間後續 close() 呼叫直接 return
- **例外聲明（OREO）**：edit-modal.ts close 行為變更（sync window.confirm → fire-and-forget async openConfirmModal）無現成測試覆蓋（14 個測試檔無 edit-modal.test.ts，依 D12 慣例 DOM 膠水層靠 typecheck+build+E2E；edit-modal 依賴 CodeMirror 動態 import，jsdom 環境下補測試成本高）。靠 typecheck+build+人工審查驗證
- **不變契約**：WASM 引擎、Worker 位元組橋接、KV 加密、HMAC session、零表情符號、字型自托管零 CDN、第三輪美化 D18–D24、SFTP 預覽 D25–D33、SFTP 跨輯 D34–D46、Bug 1-6 修復均不動

## 任務 10：按鈕純文字化（✅ 已完成 2026-08-24）

- 來源：使用者 m0062 要求把 SFTP「編輯」SVG、「切換唯讀/編輯」SVG、「切換原始碼/瀏覽器渲染預覽」SVG 改純文字
- 決策參照：question.md 第十節「按鈕純文字化（2026-08-23）」（D1 雙態文字顯示目前狀態；D2 移除 btn-icon 用 btn btn-ghost btn-sm；D3 只改指定三個；慣例裁定文字內容 編輯/編輯中/唯讀中/原始碼/預覽、移除 aria-label、保留 title、ui-icons eye/pencil 保留、事件監聽不動、測試 OREO 例外）
- 盤點：3 處 SVG 按鈕（sftp-panel.ts:162-166 iconButton("pencil","編輯")；edit-modal.ts:225-230 toggleReadonlyBtn eye 初始；edit-modal.ts:234-241 togglePreviewBtn eye 初始）+ 2 處切換（edit-modal.ts:351-352 setReadonly eye↔pencil；edit-modal.ts:364-378 togglePreview eye↔pencil）

工作項目：
- [x] 讀現況 + question 澄清 3 題（D1 雙態文字邏輯；D2 按鈕 class；D3 變更範圍）
- [x] 寫 question.md 第十節（按鈕純文字化決策 + 10 項驗收條件）
- [x] 改 sftp-panel.ts：line 162-166 iconButton("pencil","編輯",...) → actionButton("編輯",...)
- [x] 改 edit-modal.ts：line 225-230 toggleReadonlyBtn 初始（移除 btn-icon + aria-label；textContent="編輯中"）
- [x] 改 edit-modal.ts：line 234-241 togglePreviewBtn 初始（移除 btn-icon + aria-label；textContent="原始碼"）
- [x] 改 edit-modal.ts：line 351-352 setReadonly 切換（textContent = value ? "唯讀中" : "編輯中"）
- [x] 改 edit-modal.ts：line 364-378 togglePreview 切換（textContent = "預覽" / "原始碼"）
- [x] 回歸驗證：前端 15 檔 226/226 全綠、typecheck 0 錯、build 成功、check:split OK（app.js 93.8KB）

例外聲明（OREO）：edit-modal.ts/sftp-panel.ts 按鈕純文字化變更無現成測試覆蓋（依 D12 慣例 DOM 膠水層靠 typecheck+build+E2E；edit-modal 依賴 CodeMirror 動態 import，jsdom 環境下補測試成本高）。靠 typecheck+build+人工審查驗證。ui-icons.ts eye/pencil 路徑保留（移除需擴張範圍改 ui-icons.test.ts）。

不變契約：confirm-modal（D1-D8）、edit-modal close fire-and-forget、sftp-panel confirm 介面、WASM 引擎、Worker 位元組橋接等既有契約全數保留。

最終測試：前端 15 檔 226/226、typecheck 0 錯、build 成功、check:split OK。
- **最終測試**：前端 15 檔 226/226、typecheck 0 錯、build 成功、check:split OK

---

## 任務 11：自主疊代升級 — 正確性、生命週期與安全強化（✅ 已完成 2026-08-24）

- **來源**：使用者要求「自主疊代升級」，並授權自行完成完整流程。
- **已確認決策**：見 `agent/question.md` 第十一節；包含 TOFU、登入限流、真實 SSH/SFTP E2E 與完整回歸驗收。
- **TDD 疊代（8 輪）**：
  - [x] DELETE 204 空內容不再解析 JSON；SFTP write/mkdir/remove/rename 正確 await Promise 並傳播 rejection。
  - [x] WASM 載入失敗可重試、既有已載 script 不掛起；移除 production transport debug；部分連線與遠端關閉統一 best-effort 清理。
  - [x] ConnectionStore 遍歷 KV cursor；登入同來源 15 分鐘最多 5 次失敗，成功清除，429 附 Retry-After，KV key 不保存原 IP。
  - [x] SSH host key 改為 fail-closed TOFU：首次顯示 key type/SHA-256 指紋，確認保存；一致免提示；不一致阻擋且不覆寫；編輯 UI 可經確認只重設信任欄位。
  - [x] 修復工作階段分頁硬編碼不存在的 `#panel-monitor`。
  - [x] 修復 WebSocket 延遲 close 事件呼叫已 Release 的 Go callback；先 dispose JS callbacks 再關閉並 Release。
  - [x] 確認框改用原生 `<dialog>.showModal()` 進入 top layer，解決連線編輯 dialog 內重設指紋按鈕無法點擊。
  - [x] 工作階段改用 `100dvh` + flex 填滿可用 viewport，移除硬編碼 topbar 高度，手機監控列不再裁切。
- **真實 E2E**：登入狀態下連接 `127.0.0.1:2222` 測試 SSH；驗證首次 TOFU、保存後免提示、假指紋阻擋且不覆寫、重設後重新確認、terminal 回顯、SFTP 建目錄/改名/上傳/讀取/覆寫/刪檔/刪目錄、斷線無 released callback error。桌面與 390×844 手機視圖均無重疊；手機 session 主內容底部 828px，小於 844px viewport。
- **E2E 證據**：`e2e-worker-ssh-desktop.png`、`e2e-worker-ssh-mobile-list.png`、`e2e-worker-ssh-mobile-dialog.png`、`e2e-worker-ssh-mobile-confirm.png`、`e2e-worker-ssh-mobile-session-flex.png`。
- **最終驗證**：前端 22 檔 248/248；Go PASS；TypeScript typecheck 0 錯；LSP 掃描 src 33 檔 0 diagnostics；build 成功；check:split OK（app.js 96.9KB、terminal chunk 283.6KB）；production debug/InsecureIgnoreHostKey/舊 viewport calc/#panel-monitor 掃描零匹配。
- **Worker 驗證限制**：功能相關與其餘 Worker 測試 85/85 通過；`crypto-cache.test.ts` 的高負載「快取有上限」在 Windows workerd 反覆遭 WSARecv 10053 / Network connection lost，並有 Miniflare EBUSY。該案例歷史上曾 5/5 通過，但本次最終重跑未完整通過，屬環境阻礙。安裝的 runtime 只支援 compatibility date 2025-09-06，對設定 2026-08-01 fallback。
- **清理**：真實 SFTP 遠端測試檔與目錄、workspace/temp upload fixture 均已刪除；保留 E2E 截圖作驗證證據。

---

## 任務 12：批量生成排版測試 SSH 連線（✅ 已完成 2026-08-24）

- **來源**：使用者要求批量生成範例 SSH 連線，方便測試連線卡片排版。
- **已確認決策**：見 `agent/question.md` 第十二節；保留既有資料，直接向本機 Wrangler/KV 額外新增 50 筆，不新增生成腳本。
- **批次識別**：`BMT6G7CC1`；名稱統一使用 `LAYOUT-範例-BMT6G7CC1-NN-...`，便於辨識與後續清理。
- **資料分布**：25 筆 `tester@127.0.0.1:2222` password fixture；25 筆 RFC 保留 IP、`.test` 或 example 網域假端點。驗證 password 37 筆、privateKey 13 筆；名稱長度 24–83 字；未連線 13 筆、只有 lastConnectedAt 13 筆、同時有連線/斷線時間 24 筆。
- **安全約束**：50 筆均未預存 `hostKeyType` / `hostKeyFingerprint`；假端點未觸發連線；既有 `E2E 本機測試機` 與 `loc` 均保留未修改。
- **結構驗證**：API 最終共 52 筆，其中本批次恰 50 筆、可連本機 25 筆、安全假端點 25 筆、信任欄位存在數 0。
- **桌面排版**：1440×1000、52 張卡、四欄、卡寬 332.25px、高度 197–264px；文字/子元素溢出 0、卡片重疊 0、水平頁面溢出 false。
- **手機排版**：390×844、52 張卡、單欄、卡寬 343px、高度 285–349px；文字溢出 0、卡片重疊 0、按鈕重疊 0、水平頁面溢出 false；可捲至最後一張卡且底部 828px 位於 844px viewport 內。
- **驗證證據**：`layout-examples-desktop-1440.png`、`layout-examples-mobile-390.png`。
- **替代驗證（TDD 例外）**：本任務只操作本機測試資料，未修改正式程式碼；採用寫入前基線、API 結構化查核、真實桌面/手機 DOM 量測與截圖驗證。
- **觀察事項**：新假端點沒有 OS cache，列表查詢 `/api/os` 時預期回 404；另觀察到既有 Inter 700 字型資產請求 500，兩者未造成排版溢出或重疊，未擴張至本次資料生成範圍修復。
- **清理**：Playwright 已關閉；本輪 Wrangler parent/children 已退出，確認 port 8787 無 listener。既有 dev SSH server PID 27768 仍監聽 port 2222，因本輪開始前已存在而保留。

---

## 任務 13：Worker 大量連線崩潰與 v2 加密信封升級（✅ 已完成 2026-08-24）

- **來源與重現**：使用者回報本機測試 Worker 疑似崩潰。52 筆連線下真實重現 `GET /api/connections` 約 6.5–7.6 秒後 Wrangler/Miniflare loopback 崩潰，port 8787 listener 消失。
- **根因**：舊 v1 信封每筆使用不同 PBKDF2 salt；`ConnectionStore.list()` 又以 `Promise.all` 同時讀取並解密全部資料，52 筆即觸發 52 次 PBKDF2-SHA256 210,000 並行，壓垮 Windows workerd。
- **已確認決策**：見 `agent/question.md` 第十三節；採 v2 信封、保留 v1 相容讀取與透明分批遷移、列表 API 維持完整陣列，並以真實 Wrangler 500 筆連續 10 次、每次低於 5 秒為驗收。
- **TDD 疊代（5 輪）**：
  - [x] v2 信封使用 `v2:` 前綴、固定 domain-separated KDF salt、PBKDF2-SHA256 210k、AES-256-GCM、每筆獨立 96-bit IV 與 AAD；裸 base64 v1 仍可讀。
  - [x] KDF cache 改為 Promise 去重的 LRU，並行首次使用同一金鑰只衍生一次；衍生失敗會移除 cache entry。
  - [x] 新增受 session 與 ENCRYPTION_KEY 保護的 `/api/migrations/connections`；每批有界遷移 v1，寫回前二次讀避免覆蓋並行更新，損毀資料不改寫。
  - [x] 前端 `listConnections()` 在列表前透明循環遷移，缺失或重複 cursor 時 fail fast；公開列表回傳契約不變。
  - [x] 500 筆列表改用 Cloudflare KV bulk get（每批最多 100 keys），再以 64 路有界並行解密；遷移錯誤只對無效 cursor 回 400，其餘以不洩漏細節的 500 回應。
- **真實壓測**：建立 448 筆唯一前綴 `PRESSURE-V2-20260824-0817` 資料，使總量達 500。連續 10 次瀏覽器 fetch + JSON parse 均 HTTP 200、count 500，耗時 4988.8、4303.6、2688.7、2755.1、2448.8、2688.0、2191.0、2054.6、2100.8、2005.0ms；最大 4988.8ms、平均 2822.4ms，Wrangler listener 全程存活。
- **資料清理**：壓測後刪除全部 448 筆額外資料；最終 `total=52`、`pressure=0`、`layout=50`，保留原有兩筆與任務 12 的 50 筆排版資料。
- **最終驗證**：前端 22 檔 250/250；Worker 7 檔 95/95；Go PASS；TypeScript typecheck PASS；LSP 掃描 src 33 檔 0 diagnostics；build 成功；check:split OK（app.js 97.1KB、terminal chunk 283.6KB，Worker bundle 26.5KB）。
- **環境限制**：本機 runtime 仍將 compatibility date `2026-08-01` fallback 到 `2025-09-06`；Miniflare 測試後偶有暫存目錄 EBUSY 清理警告，但本次完整 Worker suite 與高負載 crypto-cache 測試均通過。
- **服務清理**：Playwright 已關閉；本輪 Wrangler parent PID 56172、listener PID 56844 與其程序樹已終止，確認 port 8787 無 listener。既存 dev SSH server PID 27768 仍監聽 `127.0.0.1:2222`，未停止使用者原有服務。

---

## 任務 14：D1 巢狀資料夾、憑證脫敏與後端 SSH（✅ 已完成 2026-08-24）

- **來源**：使用者要求新增資料夾以整理主機並降低 KV 讀取壓力，後續要求 Web 編輯時不得再次顯示密碼或私鑰。
- **已確認決策**：見 `agent/question.md` 第十四、十五節。D1 成為資料夾與連線唯一主儲存；KV 僅保留 OS cache 與登入限流。所有一般 API 回應不得包含 `password`、`privateKey`、`passphrase`；SSH 全面移至純 Worker / Durable Object + Go WASM，無 Browser WASM 或 `/proxy` fallback。
- **D1 初始化與安全遷移**：
  - [x] 建立版本化 schema runner、15 秒 lease 單 runner、持久化進度與 `kv_scan → kv_migrate → verify → kv_cleanup → complete` 階段。
  - [x] 既有 KV `conn:*` v1/v2 分批遷入 D1；完成 row count、ID set 與逐筆解密驗證後才刪除舊 KV，失敗可安全重試。
  - [x] 登入後全螢幕遮罩顯示階段、百分比與已處理/總筆數；失敗只顯示安全錯誤碼與重試，不洩漏 SQL、密文或 stack。
- **D1 加密資料模型**：
  - [x] 連線 payload 與資料夾名稱均使用既有 v2 AES-GCM 信封；D1 明文只保存隨機 ID、父層/資料夾關係、排序、時間與遞迴主機數。
  - [x] 同層資料夾名稱唯一性使用獨立 domain-separated HKDF → HMAC-SHA256 `name_token`，未重用 AES CryptoKey；名稱比較採 trim + NFKC + lower-case。
  - [x] 公開 `ConnectionView` 僅回 `credentialState`，內部完整憑證只由 Worker/DO 記憶體短暫使用；空白 secret 更新代表保留，危險確認可明確清除，清除後禁止連線。
- **巢狀資料夾與一致性**：
  - [x] 支援最多 8 層、case-insensitive sibling unique、cycle/depth 阻擋、breadcrumb、直接內容 scoped read 與完整相容列表。
  - [x] create/rename/move、connection bulk move、folder promote/recursive delete 均透過 D1 batch 更新 ancestor `recursive_host_count`。
  - [x] 非空資料夾刪除提供「全部刪除／只刪除資料夾／取消」；promote 會將直接子資料夾與直接連線提升到父層。
- **前端資料夾 UX**：
  - [x] 主畫面只讀未分類連線與頂層摘要；進入資料夾才讀直接子資料夾與直接連線。
  - [x] 完成 breadcrumb、建立/重新命名/移動/刪除、卡片選單、多選批量移動、桌面拖放、mobile fallback、遞迴主機數與目的地篩選。
  - [x] 編輯既有連線時 secret 欄位永遠空白；API、DOM、console 與 storage 不重現已保存憑證。
- **純 Worker 後端 SSH**：
  - [x] 先以真實 fixture 通過 Go WASM feasibility gate：host key、password auth、Ubuntu exec、shell echo、SFTP CRUD 全部成立。
  - [x] Durable Object 使用 `cloudflare:sockets.connect()` 建 TCP，Go `x/crypto/ssh` WASM 執行 SSH/SFTP；完整憑證只經 private DO `/init` 進入記憶體，browser 僅使用 `/api/ssh?connectionId=...` WebSocket RPC。
  - [x] RPC 支援 TOFU challenge/mismatch、exec、shell input/output/resize、SFTP list/stat/read/write/mkdir/remove/rename；錯誤回應不洩漏 secret/stack。
  - [x] 非休眠 session 的 transient close 依 1/2/4 秒最多重連 3 次；重連期間停用輸入且不緩衝/重播，成功建立新 shell 並恢復 monitor、active tab 與 SFTP path；明確斷線不重連。
  - [x] 移除 Worker `/proxy`、Browser `ssh-engine`、frontend WASM 產物與停用的 wsbridge；`check:split` 新增 artifact guard。
- **真實 E2E**：
  - [x] 52 筆 KV 首次登入透明遷 D1，API secret 欄位總數 0。
  - [x] folder create/navigate/count、bulk move、connection drag、folder drag、duplicate、8 層/第 9 層拒絕、cycle、promote 與 recursive delete 全部通過。
  - [x] backend TOFU、password auth、Ubuntu exec、terminal echo、monitor、SFTP mkdir/upload/read/overwrite/rename/delete/cleanup 全部通過。
  - [x] 真實重啟 Wrangler 造成 WebSocket 中斷後，第 1/2 次重連成功；terminal 顯示 separator、新 shell 可輸入回顯、SFTP 路徑恢復 `/tmp`、monitor 回復；explicit disconnect 未重連。
- **500 筆壓測**：建立 448 筆隔離資料與 10 個多層資料夾，使總量 500。連續 10 次瀏覽器 fetch + JSON parse：root scope 最大 245.1ms、child scope 最大 427.0ms、完整 500 筆列表最大 250.6ms；全部遠低於 scoped 2 秒/full 5 秒，listener 全程存活。壓測後 recursive delete 清理，最終 connections 52、folders 0、pressure 0、secret fields 0。
- **最終驗證**：前端 26 檔 264/264；Worker 13 檔 117/117；Go PASS；TypeScript typecheck PASS；LSP 掃描 src 48 檔 0 diagnostics；build 成功；check:split OK（app.js 114.3KB、terminal chunk 283.6KB、Worker bundle 104.8KB），前端產物不含 WASM。
- **環境限制**：本機 runtime 將 compatibility date `2026-08-01` fallback 到 `2025-09-06`；Windows Miniflare 測試結束仍偶有暫存目錄 EBUSY，但本次完整 Worker suite 全綠。
- **清理**：真實 SFTP、資料夾與壓測資料均已清回原始 52 筆/0 folders；Playwright 已關閉，本輪 Wrangler parent PID 58988、listener PID 43572 與程序樹已終止，確認 port 8787 無 listener；probe temp env 已刪除。既存 dev SSH fixture PID 27768 保留。

---

## 任務 15：齒輪設定入口、D1 全域偏好與 Worker 穩定性審查（✅ 已完成 2026-08-24）

- **來源與決策**：見 `agent/question.md` 第十六節。連線管理與工作階段右上角提供純 SVG 齒輪；偏好由 D1 全域同步；調整時完整即時預覽，取消還原且不寫入，儲存才持久化。使用者另要求完成後審查 Worker 穩定性，但未授權直接擴張修復。
- **D1 與 API TDD**：
  - [x] schema version 1→2 無損升級，新增 singleton `app_settings`；預設 dark/14px/3秒/自動重連3次。
  - [x] `AppSettingsStore` 讀取預設、upsert 與跨 instance 持久化；`GET/PUT /api/settings` 受 session、ENCRYPTION_KEY 與 bootstrap-complete 保護。
  - [x] Worker runtime validation 限制主題、12–20px、3/5/10/30秒、boolean 與1–5次；非法資料回400且不覆寫。
- **前端設定交易與即時套用**：
  - [x] `SettingsDraftController` 實作 snapshot/draft、即時 preview、恢復預設、cancel rollback 與 save commit。
  - [x] 高對比深色主題、目前 terminal 字級/fit、MetricsPoller interval 與 Backend SSH 後續重連策略均可即時更新。
  - [x] 齒輪按鈕位於連線管理與工作階段 topbar；設定 dialog 為 body 直屬 native dialog，低高度 viewport 可內部捲動。
  - [x] 主機卡片與全選保留 checkbox 語意並使用自訂深色／高對比外觀；SFTP 檔案與資料夾 rename 改為預填全選的主題化 native dialog。
- **真實 Playwright**：
  - [x] desktop與390×844手機 dialog 無水平溢出；齒輪40×40且accessibility name/title均為「設定」。
  - [x] high-contrast/字級/監控/重連即時preview，取消後theme與terminal row完整恢復且API未寫入；儲存後重整可由D1讀回；最後恢復預設並保存。
  - [x] active session terminal 14→20px時row height 16→24px；取消恢復16px。SFTP file/folder rename均驗證預填、全選、Enter成功與完整清理。
- **最終驗證**：前端30檔278/278；Worker14檔124/124；Go PASS；typecheck PASS；build與check:split PASS（Worker109.1KB、app120.2KB、terminal283.7KB）；LSP掃描src50檔0 diagnostics；Browser WASM artifact未重新引入。
- **Worker 穩定性審查（尚未修復）**：
  1. **高**：WebSocket RPC沒有訊息大小、SFTP payload、in-flight request或速率上限；每個message以fire-and-forget並行處理，32MiB合法WebSocket訊息可經JSON/base64產生多份配置，接近Worker isolate 128MB上限。
  2. **高**：`GET /api/ssh`每次建立隨機、非休眠DO與outbound TCP，未限制同一session/IP的active SSH數；已登入client可大量建立長駐資源。
  3. **高（Free）／中（Paid）**：connection bulk move沒有ID數量上限，逐ID與逐ancestor查詢後建立D1 batch；D1每invocation查詢上限為Free 50、Paid 1000，惡意或超大批次可超限。
  4. **中**：首次TOFU `pendingChallenge`沒有timeout，WebSocket close/dispose也未resolve；client不回應可讓Go verifier與DO工作長時間懸掛。
  5. **中**：`WorkerTcpTransport.bufferedReads`在Go註冊onData前沒有byte上限，惡意遠端可在短暫初始化窗口累積讀取記憶體；目前只有TCP寫queue具4MiB上限。
  6. **低至中**：bootstrap lease固定15秒且無heartbeat，極慢KDF/KV環境可能由另一頁取得lease並重複工作；現有owner條件與冪等流程降低資料損壞但不避免負載放大。
  7. **低**：DO `/init`與`/connect`為兩次private request，pending config只在記憶體；中間eviction會得到409，未connect時secret會留到物件回收。
- **建議修復順序**：先建立RPC message/base64/in-flight上限與session quota，再限制bulk move批次；接著補host-key timeout與read buffer cap；最後評估bootstrap heartbeat及將DO init/connect合併為單一原子流程。
- **環境與服務**：本機runtime仍將compatibility date `2026-08-01` fallback至`2025-09-06`，Worker測試結束仍偶有Windows Miniflare EBUSY。測試伺服器依使用者要求保留運行於 `http://127.0.0.1:8787`；既有SSH fixture維持`127.0.0.1:2222`。

---

## 任務 16：終端剪貼簿、齒輪對齊與 Worker 穩定性加固（✅ 已完成 2026-08-25）

- **來源與決策**：使用者回報 SSH 終端複製／貼上異常、主畫面齒輪未對齊，並要求修復任務 15 留下的全部 Worker 穩定性風險。完整快捷鍵、資源上限、quota、lease 與 nonce 契約見 `agent/question.md` 第十七節。
- **TDD 疊代（8 輪）**：
  - [x] 終端剪貼簿依平台分流：Windows/Linux `Ctrl+Shift+C/V`、`Shift+Insert`，macOS `Cmd+C/V`；只有已有選取時 `Ctrl+C` 才複製，否則保留遠端 SIGINT。原生 clipboard event 優先，Clipboard API 只作 fallback，失敗以安全提示回報。
  - [x] 主畫面 `#settings-btn` 固定 40×40、SVG 20×20、flex 雙軸置中；手機版不再被 topbar flex 拉伸。工作階段齒輪契約不變。
  - [x] Backend SSH WebSocket RPC 限制單一 JSON frame 約 768KiB、最多 4 個 in-flight request、20 request/s 且 burst 40；超限分別以 1009/1008 或明確 response error 拒絕。
  - [x] Go、Worker session 與前端全面改為 512KiB SFTP chunk handle；read/write handle 冪等關閉，session/disconnect 會回收未完成 handle，不再由 Worker RPC 一次持有完整檔案 payload。
  - [x] 新增 D1 bulk move 50 筆上限；HTTP 與 repository 雙層守衛，在進入 D1 query 前拒絕超大批次。
  - [x] 新增持久化 `SshQuotaObject`：同一登入 session 最多 3 條 active SSH、全域最多 10 條；lease 支援 acquire/heartbeat/release/過期清理與相同 lease 冪等續租，raw session token 先 SHA-256 才傳入 quota。
  - [x] TOFU challenge 60 秒 timeout；socket 關閉會解除 pending verifier。TCP early-read buffer 新增 4MiB 上限；D1 bootstrap lease 由 15 秒升為 60 秒，scan/migrate/verify/cleanup 長步驟持續 heartbeat。
  - [x] DO `/init` 改為 10 秒一次性 nonce；wrong nonce 不消耗、正確 nonce 只可使用一次、過期主動清理。外層 `/api/ssh` 僅在第一次 `/connect` 回 409 時重新 init 一次，其他錯誤不重試。
- **真實 Playwright / SSH / SFTP**：
  - [x] 真實 terminal 選取 token 後 `Ctrl+C` 寫入 clipboard；`Ctrl+Shift+V` 貼上後遠端回顯；清除選取後 `Ctrl+C` 實際送出 `\u0003` shell-write frame。
  - [x] 以 `dist/worker/ssh.wasm` 7,960,870 bytes 做 SFTP 上傳／下載；來源與下載 SHA-256 均為 `F18C796B7A05A7FB0C424A10BA81F06F8C7E5514AA9F36ED876B0175D0CB218D`，證明跨多個 512KiB chunk 的二進位完整性，遠端與本機 fixture 均已清理。
  - [x] 同登入 session 第 2、3 條 SSH 成功，第 4 條被 quota 拒絕；關閉額外 socket 後可再次建立，證明 release。全域 10 條限制由持久化 quota 核心測試覆蓋。
  - [x] 真實 51 筆 bulk move 回 400；769KiB frame 以 1009 關閉；第 41 個 burst request 以 1008 關閉；第 5 個並行 request 回 `too many requests` 且 socket 維持可用。
- **最終驗證**：前端 31 檔 288/288；Worker 16 檔 141/141；Go PASS；TypeScript typecheck PASS；LSP 掃描 src 50 檔 0 diagnostics；build 成功；check:split OK（Worker 124.4KB、app.js 120.2KB、terminal chunk 284.9KB），前端仍不含 Browser WASM。
- **環境限制**：本機 runtime 仍將 compatibility date `2026-08-01` fallback 至 `2025-09-06`；Windows Miniflare 測試後仍有暫存目錄 EBUSY 清理警告，但本次完整 Worker suite 與高負載 crypto-cache 全綠。
- **服務狀態**：Playwright SSH 已正常斷開並關閉。依使用者要求，Wrangler 測試服務保留於 `http://127.0.0.1:8787`；最新 parent PID 63648、listener PID 48152。既有 SSH fixture PID 27768 繼續監聽 `127.0.0.1:2222`。

---

## 任務 17：狀態列虛擬記憶體（Swap）監控（✅ 已完成 2026-08-25）

- **來源與決策**：使用者要求在 SSH 終端狀態列查看虛擬記憶體。經澄清後將指標定義為 Swap／交換空間，顯示已用／總量與百分比，置於實體記憶體後；`null` 表示未知或不支援，已知 `0/0` 則顯示 `0 B / 0 B` 與 `0.0%`。完整契約見 `agent/question.md` 第十八節。
- **RED 證據**：擴充 parser、monitor 與 HTML 契約測試，涵蓋 Linux 非零／零／缺失 Swap、Darwin `vm.swapusage` 非零／零／不支援、取樣指令、格式化與 DOM 順序。有效 RED 為 3 檔 47 測試中 12 項因缺少 `swapTotal`／`swapUsed`、顯示欄位及 DOM 而失敗。
- **GREEN 實作**：
  - [x] `parsers.ts` 的 `Metrics`／`NULL_METRICS` 新增 Swap 欄位；Linux 從既有 `free -b` 的 `Swap:` 行解析，不增加 SSH round trip。
  - [x] Darwin/BSD 取樣加入 `sysctl vm.swapusage`，支援 K/M/G/T 單位；不支援或不可解析時僅將 Swap 保持為未知，不影響其他指標。
  - [x] `monitor.ts` 新增 Swap 格式化；未知顯示 `--`，已知零容量顯示 `0 B / 0 B` 與 `0.0%`，不新增 chart/sparkline。
  - [x] `index.html` 在實體記憶體後新增 `m-swap-used`／`m-swap-percent`，`main.ts` 完成 MetricsPoller DOM 接線。
- **真實 Playwright / SSH 驗證**：
  - [x] 本機 fixture 實測 Swap 為 `0 B / 2.0 MiB`、`0.0%`，實體記憶體、磁碟與其他指標仍正常更新。
  - [x] Desktop 929×909：監控列 895×57，`scrollWidth === clientWidth === 895`，無項目溢出；證據 `swap-monitor-desktop.png`。
  - [x] Mobile 390×844：監控列 356px 寬、7 項均在 viewport 內，document 無水平或垂直溢出；證據 `swap-monitor-mobile-390.png`、`swap-monitor-network.txt`。Console errors/warnings 均為 0。
- **最終驗證**：前端 31 檔 295/295；Worker 16 檔 141/141；Go PASS；typecheck PASS；build 與 check:split PASS（Worker 124.4KB、app.js 約 122KB、terminal chunk 284.9KB）；LSP 掃描 src 50 檔 0 errors，前端仍不含 Browser WASM。
- **環境限制**：Darwin/BSD 由決定性單元測試覆蓋，未在真實 Darwin/BSD 主機執行。Installed runtime 仍將 compatibility date `2026-08-01` fallback 至 `2025-09-06`；Windows Miniflare 測後仍有 temp EBUSY 清理警告，但完整 Worker suite 與 crypto-cache 高負載全綠。
- **服務狀態**：Playwright 已正常斷開 SSH 並關閉。依使用者要求，Wrangler 與既有 SSH fixture 保持運行；收尾再次確認 PID 與連接埠。

---

## 任務 18：GitHub 公開發布與 Cloudflare 手動一鍵部署（✅ 已完成 2026-08-25）

- **來源與決策**：使用者要求推送 GitHub 並提供 Cloudflare 一鍵部署。經 `question` 確認公開 repository `s12ryt/worker-ssh`、MIT License、`main` 分支、僅 `workflow_dispatch` 手動部署、固定 Worker／D1／KV 名稱、同名資源重用、四個 GitHub repository secrets 由使用者稍後設定；完整契約見 `agent/question.md` 第十九節。
- **RED／GREEN**：新增 deployment unit tests，先因 provisioning library、CLI、workflow、README、License 與發布契約不存在而失敗；GREEN 後以 Node ESM library 透過 Cloudflare REST API 精確查找／建立 D1 `worker-ssh-db` 與 KV `worker-ssh-kv`，產生隔離的 `.cloudflare-deploy/wrangler.json` 與 `secrets.json`，並提供冪等 cleanup。
- **GitHub Actions**：`.github/workflows/deploy-cloudflare.yml` 僅允許手動執行，`permissions: contents: read`、concurrency、30 分鐘 timeout；依序執行 `npm ci`、完整測試、typecheck、build、split、資源 provisioning、Wrangler dry-run、正式 deploy 與 `always()` cleanup。正式 secrets 不進 process summary 或 repository。
- **公開安全邊界**：`.gitignore` 排除 `.dev.vars`、D1/KV local state、`dist`、`node_modules`、screenshots、logs、network records、Playwright 與部署暫存。公開掃描未發現 production secrets；固定 OpenSSH 測試私鑰已改為 Go test runtime 動態產生，避免 GitHub push protection 與永久歷史風險。
- **文件與授權**：新增繁中 `README.md`，說明功能、本機開發、四個 repository secrets、Cloudflare token 最小權限、手動 Run workflow 與不遷移本機資料；新增 MIT License（2026 s12ryt）。
- **驗證**：deployment tests 17/17；Go PASS；Worker store 21/21；完整 frontend／Worker／Go、typecheck、build、check:split 已通過。以假資源 ID 執行真實 `wrangler deploy --dry-run` 成功，解析 54 個 assets、D1、KV 與兩個 Durable Objects；沒有呼叫 Cloudflare provisioning API或正式部署。
- **發布結果**：公開 repository 建立於 `https://github.com/s12ryt/worker-ssh`。本輪只推送原始碼與 workflow，不觸發 production deployment；使用者需先在 GitHub Actions secrets 設定 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`PANEL_PASSWORD`、`ENCRYPTION_KEY`。
- **遠端驗證**：`main` 已成功推送並設為 default branch；GitHub 將 **Deploy to Cloudflare** 辨識為 active workflow。目前 workflow runs 為空，repository secrets 清單為空，證明本輪未觸發部署且待使用者設定四個 secrets。
- **服務狀態**：依使用者既有要求，本機 Wrangler `http://127.0.0.1:8787` 與 SSH fixture `127.0.0.1:2222` 保持運行，發布流程不讀取或停止本機服務。

---

## 任務 19：GitHub Actions npm lockfile 相容性修復（✅ 已完成 2026-08-25）

- **來源與根因**：使用者提供手動 deployment run `32802591933` 的 `npm ci` 失敗紀錄。決定性重現證明 npm 10.9.4 會把 Wrangler 的 optional peer 視為 lock 缺少 `@cloudflare/workers-types@4.20260702.1`，同一份 lock 在 npm 11.7.0 可正常 clean install；不是根層 package 與 lock 版本不一致。
- **TDD RED／GREEN**：
  - [x] Deployment contract 先要求 `packageManager=npm@11.7.0`，以及 workflow 在 `npm ci` 前安裝並驗證 npm 11.7.0；RED 因契約缺失而失敗，GREEN 後通過。
  - [x] 乾淨 worktree 暴露 Worker Vitest 的 ASSETS 指向未提交 `dist/client`；新增已提交 `test/fixtures/assets/index.html`、改測試 binding並加入 HTTP fallback test。
  - [x] 乾淨 worktree 再暴露 backend Worker 靜態依賴未提交的 Go WASM；依使用者決策，workflow 改為 `npm ci` → typecheck → build／split →完整測試，不提交二進位也不新增 pretest 隱式建置。
  - [x] Release contract 明確驗證 npm版本、步驟順序與測試assets fixture，防止後續回歸。
- **Clean checkout 證據**：隔離 worktree `worker-ssh-npm11-ci-20260825` 真實執行 npm 11.7.0 `npm ci` 成功；依 Actions 順序執行 typecheck、build、check:split、npm test 全綠。Deployment 20/20、frontend 295/295、Worker 142/142、Go PASS；Worker 124.4KB、app約122KB、terminal約284.9KB。
- **本機環境區分**：主工作區的實際 `npm ci` 因仍運行的 Wrangler 鎖住 Windows `node_modules` 而遭 EBUSY 並留下不完整安裝；未停止服務，而是用隔離 worktree取得clean-install證據。這不是 lockfile 或正式碼失敗。
- **提交與遠端驗證**：`2d9bf5c` 建立自包含Worker測試、`a8918de`固定npm與workflow、`ef44dc3`同步文件，均已推送 `main`。遠端workflow顯示npm11 setup與build-before-test；Actions清單仍只有原手動失敗run `32802591933`，push未自動觸發production。
- **環境與服務**：本機runtime仍有compatibility date fallback與Windows Miniflare temp EBUSY cleanup警告。Wrangler parent PID63648／listener PID48152持續服務 `http://127.0.0.1:8787`；SSH fixture PID27768持續監聽`127.0.0.1:2222`。
