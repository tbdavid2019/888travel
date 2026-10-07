# Changelog / 更新日誌

All notable changes to this project will be documented in this file.
本專案的所有重要變更均會記錄於此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.5.0] - 2026-10-07

### Added / 新增功能
- **AI Agent 程式化介面與專屬權限架構 (RESTful Agent API & Bearer Authentication)**：
  - **RESTful `/api/v1` 端點**：推出專為外部 AI 代理（Claude Code、Antigravity、Cursor、Windsurf、ChatGPT Custom GPT 等）量身打造的標準 RESTful API，全面支援 `GET`、`POST`、`PUT`、`DELETE` 操作與 CORS 跨來源存取。
  - **獨立 Agent API Key (`rr_agent_...`)**：採用專屬且具隨機高熵的 Bearer Token，與管理者帳號密碼完全隔離，可隨時自設定面板產生、重新簽發或單鍵撤銷，兼顧極致便利與防禦深度。
  - **旅程全生命週期 CRUD (`/api/v1/trips`)**：外部 Agent 可列出全部旅程（包含摘要統計、時區及細項計數）、查詢單趟旅程、建立新旅程、更新目的時區與說明，以及完整刪除旅程。
  - **細項原子與高吞吐批次規劃 (`/api/v1/trips/:id/segments`)**：
    - 支援單筆新增與高效批次陣列傳入（單一 HTTP 請求即可寫入整趟多日行程，大幅節省 LLM Token 與往返延遲）。
    - 支援修改細項與單鍵安全刪除，內建自動墓碑記憶（Tombstoning in `store.deletedSegs`），杜絕後續背景同步復活。
  - **手動資料不可侵犯守護 (The Manual Invariant Protection)**：
    - 所有透過 Agent API 新增或變更的項目皆強制鎖定 `source: "manual"`，背景 Google Calendar 與 Gmail 同步引擎絕對無法覆寫或抹除 Agent 與人類精心規劃的行程。
  - **全 7 大類別與替代備案全面連動**：完整涵蓋 `flight`、`hotel`、`restaurant`、`rail`、`car`、`ride`、`other`，並原生支援 `fallback` 備案物件注入。

- **機器可讀規格與標準 Agent Skill 匯出 (`llms.txt`, `llms-full.txt`, `SKILL.md`)**：
  - **標準 `llms.txt` 與 `llms-full.txt`**：於根路徑公開提供符合 llmstxt.org 標準之規範清單與完整 API 參考手冊，供網路爬蟲與 AI 客戶端零門檻探索。
  - **標準 Agent Skill 規格 (`SKILL.md`)**：依現代 Coding Agent 規範產出含 YAML Frontmatter、工具定義、資料格式與最佳實踐之技能檔，支援 `GET /skill.md` 公開檢索。

- **設定面板全新「AI Agent 開發與整合」專區 (In-App AI Agent Integration Hub)**：
  - **API 金鑰管理**：提供「產生 / 重新產生金鑰」、「顯示/隱藏密碼遮罩」、「一鍵複製金鑰」與「撤銷金鑰」完整控制面板，狀態一目了然。
  - **一鍵複製動態系統提示詞 (Copy Dynamic Agent System Prompt)**：一鍵複製已預先自動填入**當前 instance 伺服器網址**與**有效 Bearer Token**的完整 Prompt，直接貼給任何 LLM 即可瞬間學會操作 RoamRadar 為人類規劃旅遊！
  - **SKILL.md 下載與複製**：提供「複製 SKILL.md」與「下載 SKILL.md」按鈕，方便隨時匯入本地專案或分享給協作團隊。

---

## [2.4.1] - 2026-10-07

### Enhanced / 介面與功能全面優化
- **細項規劃 7 大類別整體視覺一致性與動態情境表單 (Comprehensive 7-Category Design & Dynamic Form Placeholders)**：
  - **統一圖標選單**：為所有規劃類別全面補齊專屬 Emoji 圖標（✈️ 航班、🏨 飯店 / 住宿、🍽️ 餐廳 / 美食、🚗 租車自駕、🚕 接駁 / 叫車、🚆 鐵路 / 高鐵、📌 景點 / 其他項目），徹底告別單一項目突兀的不對稱感。
  - **動態情境欄位與範例提示**：在下拉選單切換類別時，名稱、地點/路線、細節備註、預訂代號、備案欄位（名稱/地址/備註）與 Google 查詢按鈕文字即時聯動切換為專屬情境範例（例如選擇航班時提示機場/航廈與機票代碼，選擇租車時提示取車門市與 ETC 保險等）。
  - **時間軸與詳情卡片統一標籤**：旅程時間軸及詳情卡片中的類別標籤全面對齊 Emoji 視覺，強化行程一覽時的辨識度。
  - **Google Places 狀態即時穿透與快取**：Worker 端 `/auth/status` 公開端點直接回傳 `googlePlacesConfigured` 布林狀態，前端於本機持久化快取，確保在任何頁面載入與登入狀態下皆能零延遲偵測 Places API 並解鎖按鈕。


### Added / 新增功能
- **Google Places API 景點/餐廳評分與營業時間查詢 (Google Places Integration with Conditional Visibility)**：
  - **環境變數與金鑰支援**：支援 Cloudflare Worker Secrets / 環境變數 `GOOGLE_PLACES_API_KEY`，亦可直接於「設定」彈窗中的專屬區塊輸入並安全加密存入 Worker KV。
  - **嚴格條件式隱藏規範**：**若未設定 API Key，細項編輯表單中的 Google Places 查詢功能與按鈕將完全自動隱藏**；設定後則自動解鎖「📍 Google 查詢景點/餐廳評價與營業時間」功能。
  - **即時檢索與一鍵套用**：支援 Text Search 查詢全球餐廳、咖啡廳、景點，即時取得星級評分（⭐ Rating）、評論數（Reviews）、當前營業狀態（🟢 營業中 / 🔴 休息中）與格式化地址，並可選擇一鍵套用至「主要行程」或「備用替代方案」。
  - **金鑰連線測試**：設定彈窗中提供「測試 Places 查詢」連線診斷按鈕，即時回傳檢索結果以驗證 Google Cloud 權限與 API 開通狀況。

- **旅程彈性備案系統與一鍵切換機制 (Travel Fallback Plan & One-Click Switch)**：
  - **細項規劃備案摺疊卡 (`+ 備用替代方案`)**：
    - 在細項規劃表單中內建醒目的 `+ 備用替代方案 (Fallback Plan)` 摺疊展開卡，專為旅行中客滿、突發休業、趕不上行程或氣候變因設計。
    - 支援填寫備案名稱、備案地點/地址與備案備註（如營業時間、備用電話、免排隊備註等）。
  - **時間軸備案狀態徽章**：
    - 行程列表中若該細項已設定備案，自動呈現 `💡 備案已就緒` 優雅徽章與次要提示線（`↳ 備案: 名稱 · 地址`），讓旅人隨時一目了然、安心出行。
  - **細項詳情專屬備案卡片與一鍵切換 (`🔄 切換為主要行程`)**：
    - 點開規劃詳情即呈現獨立的高對比「💡 替代備案方案」卡片，提供「🗺️ 導航至備案」即時地圖導航。
    - 旅途中一旦遇上餐廳客滿或未營業，點擊 **`🔄 切換為主要行程`**，系統將以毫秒級速度**將備案與主行程原位互換**（原主行程退為備案），並即時同步至雲端 KV，解決真實旅行中最棘手的即興改期痛點。

- **第一公民「餐廳美食」細項類別 (First-Class Restaurant Plan Support)**：
  - 將 `restaurant`（🍽️ 餐廳 / 美食）正式加入細項規劃首選類型，賦予代表性活力暖色系與色彩層次（`--restaurant: #FF5A35`）。
  - 自動於郵件 AI 解析、行事曆智慧識別中支援各類知名美食關鍵字（`cafe`、`bistro`、`ramen`、`sushi`、`michelin`、`tabelog` 等）。

---

## [2.3.0] - 2026-10-06

### Added / 新增功能
- **全方位時區支援與即時目的地時差鐘 (Comprehensive Timezone & Jet Lag Support)**：
  - **本人出發地時區 (Home Base Timezone)**：
    - 「設定」彈窗新增常駐出發地時區設定（`homeTz`），預設自動偵測瀏覽器時區（如 `Asia/Taipei`），亦可從主流國際時區選單手動切換，並自動同步至 Worker 端。
    - 出發地預設由作者原版的葡萄牙波爾圖（`OPO`）在地化校正為台灣台北（`TPE`）。
  - **目的地時區自動解析 (Destination Timezone Auto-Resolution)**：
    - 結合 Open-Meteo Geocoding 即時回傳之地理時區與內建全球主要機場 `IATA_TZ` 快速對照表，自動為全球目的地精準判斷 IANA 標準時區代碼（如 `Asia/Tokyo`、`Europe/Paris`、`America/New_York`）。
    - 旅程編輯表單新增「目的地時區」欄位，支援使用者自訂或留空自動解析。
  - **卡片即時時區鐘與時差標籤 (Live Destination Clock & Jet Lag Chips)**：
    - 旅程卡片頂部資訊列新增即時時差徽章：例如 `🕒 18:45 (Tokyo · 快 1 小時)`、`🕒 11:45 (Paris · 慢 6 小時)`、`🕒 17:45 (Taipei · 無時差)`，帶有完整 UTC Offset 與雙向時區對比提示。
    - 旅程進行中（Live Travelling）時，提供最直接的當地即時鐘顯示。
  - **日曆訂閱 (ICS) 時區相容**：
    - 匯出之 ICS 訂閱 feed 與個別行程全面注入 `X-WR-TIMEZONE` 與事件時區宣告，防止外部日曆 App 匯入時產生跨日位移。
- **原生模型下拉選單與雙向同步 (Native LLM Model Select Dropdown & Two-Way Sync)**：
  - 全面揚棄跨平台相容性不佳的 `<datalist>`，改以標準原生 `<select id="s_llm_model_select">` 下拉選單搭配微調輸入框 `<input id="s_llm_model">`。
  - 點擊「🔍 取得可用模型清單」後，完整展開所有 API 回傳之有效模型清單（如 Groq 12 個模型全數可見可選），點選任一項目即自動填入模型 ID。
  - 支援 `✏️ 手動自訂輸入…` 與輸入框雙向即時聯動，並內建主流提供者常用模型推薦預設（Gemini、OpenAI、Groq、DeepSeek、Anthropic）。
  - 通過 Codex Code Review 嚴格審查，具備無死鎖事件同步、XSS 轉義防護與無障礙 `aria-label` 標籤支援。

- **全新品牌視覺圖示 (888 Travel Brand Icons)**：
  - 全站圖示改版為活力珊瑚橘底（`#FF5A35` 漸層）搭配純白粗體「888 Travel」微軟圓角（Squircle）設計。
  - 同步重繪並生成包含 `favicon.svg`、`favicon.ico`、`favicon-32x32.png`、`favicon-16x16.png`、`icon-180.png`、`icon-192.png`、`icon-512.png` 之全套高清 PWA 與桌面/手機 Favicon 資源。

### Changed / 改善與優化
- **官網頁尾作者標註與致敬更新 (Author Attribution & Credit)**：
  - 官網（Landing Page）頁尾正式更新為 **`Created with ❤️ for travel, by david888.com（修改於 Giovanni Brees）`**（英文版：`adapted from Giovanni Brees`），同時保留原作者連結致敬，明確標示 `david888.com` 為目前維護與分支修改者。
- **免跳轉 GitHub，直連 App 體驗 (Direct App Access CTAs)**：
  - 首頁底部巨型按鈕、頂部導航列與 Hero 區塊的行動呼籲（CTA）全面改為 **「直接開啟 888漫步旅遊」** / **「立即開啟 888漫步旅遊」**，直接連結進入 `https://travel.david888.com/app`，不再引導前往 GitHub 倉庫，為一般使用者帶來更即時純粹的 Web App 入口體驗。
- **線上生產環境域名切換至 travel.david888.com (Production Domain Configuration)**：
  - 正式將官方生產環境網址切換為 **`https://travel.david888.com`**，並同步至 `wrangler.toml` 的自訂網域宣告（`routes`）與 Cloudflare 邊緣路由。
  - 官網所有 `canonical`、`og:url`、`og:image`、`twitter:url`、`twitter:image` 以及 JSON-LD Structured Data 全面切換至 `https://travel.david888.com`，達成最佳 SEO 權重與社群卡片體驗。
- **網站地圖與搜尋引擎標註校正**：
  - `sitemap.xml` 與 `robots.txt` 域名更新為 `https://travel.david888.com`，結構化資料（JSON-LD）亦加入 `david888.com` 作者標記。
- **清理提供者選單名稱 (Sanitized Provider Dropdown)**：
  - 徹底移除選單標籤中寫死的具體模型名稱（如不再標註已變動或廢棄的 `(GPT-4o mini)`、`(極速 Llama 3.3)` 等），改採純粹提供者品牌名稱。
  - Worker 端後備預設模型全面升級為主流活躍版本，並增強 API 呼叫失敗時的詳細錯誤日誌，提升除錯透明度。

---

## [2.2.0] - 2026-10-06

### Added / 新增功能
- **全方位品牌重塑 (Rebranding to 888漫步旅遊 · 888RoamTravel)**：
  - 繁體中文正式名稱定名為 **「888漫步旅遊」**，英文名稱定名為 **「888RoamTravel」**。
  - 全面更新於 PWA Manifest、Web App 導覽列與動態標題、形象官網、ICS 日曆訂閱名稱（`X-WR-CALNAME`）與所有文件。
- **多模型與 OpenAI 相容 LLM 智慧郵件解析 (Universal LLM Provider Expansion)**：
  - 突破原先僅支援 Anthropic 單一廠商的限制，全面支援任何 OpenAI 相容端點（OpenAI-Compatible Base URL）：
    - **Google Gemini**（透過官方 OpenAI 相容端點 `https://generativelanguage.googleapis.com/v1beta/openai`，搭配 `gemini-2.0-flash`）
    - **OpenAI**（`gpt-4o-mini` 等）
    - **Groq**（極速推論 `llama-3.3-70b-versatile`）
    - **DeepSeek**（`deepseek-chat` 高 CP 值模型）
    - **Anthropic Claude**（原生 Messages API，預設 `claude-haiku-4-5`）
    - **自訂端點 (Custom)**（支援 Ollama、LocalAI、OpenRouter 等自建或第三方推論服務）
  - 「設定」彈窗內建提供者選單，切換時自動帶入推薦之 Base URL 與模型名稱；亦可透過 Worker 環境變數（`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_PROVIDER`）無介面靜態配置。
- **Resend API 郵件寄送服務整合 (Resend API Integration)**：
  - 支援串接 [Resend](https://resend.com) API（`RESEND_API_KEY`、`RESEND_FROM`），具備伺服器端寄送與發送測試信驗證功能。
  - 「設定」視窗可即時設定 API Key 與寄件者地址，並提供「發送測試郵件」一鍵連線驗證。
- **信箱一次性驗證碼登入 (Email OTP Login)**：
  - 登入畫面提供「密碼登入」與「信箱驗證碼 (OTP)」雙模式切換。
  - 支援發送 6 位數數字安全驗證碼至管理員信箱，具備 10 分鐘有效期限（TTL 600s）、60 秒防刷重發冷卻計時器與 5 次錯誤防暴力嘗試防護。
  - 驗證成功後無縫派發等同密碼認證之 30 天 HttpOnly Session Cookie 與 X-Auth Token。

### Changed / 改善與優化
- **中英文字級與字體工藝調教 (CJK Typography & Impeccable Craft)**：
  - 針對中文字元筆劃繁複且為全形方塊字之特性進行深度排版校準：
    - 徹底移除直接套用英文字元之寬鬆字距（如 `.22em` / `.32em`），繁體中文統一校準為自然且緊湊的 `0.02em ~ 0.05em`。
    - 提升所有標籤、徽章（Badges）、規劃類型、月份日期之最小字級至 12px ~ 13px，杜絕中文字元糊成一團的反模式。
    - 調整漢語標題行高（`line-height: 1.15 ~ 1.25`）與文字行高（`1.6 ~ 1.7`），徹底防止中文字元破音字、上下筆劃被裁切之問題。
    - 自適配響應式標題字級，避免中文字元在手機狹小螢幕上溢出。
- **後端安全與 CORS 標頭放行**：
  - Worker CORS 標頭全面補齊 `X-Auth`，確保跨域或 API 呼叫順暢無阻。

---

## [2.1.0] - 2026-10-06

### Added / 新增功能
- **全站多語系支援 (Full i18n Support)**：
  - **Web App (`travel-app.html` & `public/app.html`)**：
    - 頂部導覽列新增 `🌐 繁體中文 / EN` 快速切換按鈕，切換時即時更新介面，無需重新整理頁面。
    - 「設定」彈窗內新增「語言 (Language)」下拉選單，與頂部按鈕狀態雙向同步。
    - 使用者語系偏好自動持久化於 `localStorage`（鍵名：`travel:lang`）。
    - 完整繁體中文化所有核心視圖：旅程卡片（即將啟程 / 歷史回憶 / 足跡地圖 / 時間軸 / 行事曆）、新增/編輯規劃細項、想去的目的地、更換相片、社群分享卡片（Instagram 限時動態 9:16 卡片與年度回顧 Wrapped）、登入驗證牆、完整使用指南（Help）。
    - Google 行事曆、Gmail 同步與 Anthropic AI 郵件解析連線診斷、雲端自動快照（一鍵還原）及 ICS 日曆訂閱引導全數支援雙語。
  - **形象首頁 (`website/index.html` & `public/index.html`)**：
    - 頂部導覽列新增語系切換器與快速「開啟 App」按鈕。
    - 結構化雙語字典 `DICT`，完整涵蓋 Hero 區塊、四大核心亮點卡片、互動式旅程卡片預覽、三步驟自架部屬指引、使用者評價及頁尾版權聲明。
    - 點擊切換時以微動態即時置換 DOM 文案，並與 App 端共享語言設定。
  - **PWA 安裝清單 (`manifest.webmanifest` & `public/manifest.webmanifest`)**：
    - 應用程式名稱在地化為 `RoamRadar 旅遊雷達`，並補齊雙語應用說明。
  - **AI 代理人協同規範 (`AGENTS.md`)**：
    - 建立跨 AI 代理人（Antigravity, Cursor, Claude Code, Copilot 等）通用的工程架構手冊、資料模型不變式（Invariant Rules）、鏡像同步守則與語意規範。

### Changed / 改善與優化
- **文件全面升級與重構 (Documentation Revamp)**：
  - 大幅重寫 [`README.md`](file:///Users/david/Documents/git/tbdavid2019/travel-roamradar/README.md)，採用繁體中文優先排版，補齊完整產品特色表格、快速部署按鈕（A/B 方案）、手機 PWA 安裝指南、專案架構說明、鏡像原則與常見問答。
- **字型與排版優化 (Typography & Font Stack)**：
  - 遵循 `impeccable` 設計規範，補齊 `-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Heiti TC", "Microsoft JhengHei"` 字型備援，確保在 macOS、iOS、Windows 與 Android 各裝置上皆具備高度清晰與舒適的繁體中文字級閱讀體驗。
- **在地化日期格式**：
  - 日期區間格式化依據語系動態適配（例如中文呈現 `2026年 9月15日 – 9月18日`）。
- **鏡像同步 (Mirror Compliance)**：
  - 嚴格遵守專案發布規範，將根目錄原始碼無縫同步至 `public/` 目錄。
- **獨立儲存庫建立 (Standalone Repository)**：
  - 移除上游 Fork 網絡綁定，正式建立為獨立原創儲存庫。

### Removed / 移除檔案
- **清理舊版專用指令檔**：
  - 刪除 `CLAUDE.md`，由現代化、跨平台的通用規範 [`AGENTS.md`](file:///Users/david/Documents/git/tbdavid2019/travel-roamradar/AGENTS.md) 全面接替。

### Compatibility / 相容性保證
- **後端資料結構完整相容**：
  - 保留所有底層列舉值與儲存結構（`type: "flight" | "hotel" | "car" | "ride" | "rail" | "other"`、`source: "manual" | "calendar" | "gmail"`），完全相容 Cloudflare Worker 雲端同步、KV 儲存、ICS Feed 匯出與 JSON 備份還原。

### Acknowledgments / 致謝
- 誠摯感謝原作者 **[Giovanni Brees](https://www.giovannibrees.com)** 開源打造出優雅強大的 RoamRadar 個人旅遊中樞！

---

## [2.0.0] - 2026-07-24

### Added
- Rebranded project to RoamRadar.
- Public, self-hostable travel hub without private network dependencies.
- Cloudflare Workers + KV single-tenant architecture.
- Automatic booking ingestion from Google Calendar and Gmail (via Anthropic Claude Haiku).
- Forward-any-email (+trip) parsing pipeline.
- Interactive timeline, year-in-review calendar, and "been-there" world map.
- Story-ready 9:16 social share cards and yearly Wrapped stats.
- Weekly automated snapshot backups with one-tap restore.
