# Changelog / 更新日誌

All notable changes to this project will be documented in this file.
本專案的所有重要變更均會記錄於此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- **動態獲取可用模型清單 (Dynamic Live LLM Model Fetching)**：
  - Worker 新增 `POST /settings/llm/models` 端點，直接連線至 OpenAI、Groq、DeepSeek、Google Gemini、Anthropic 的官方 `/models` API，即時抓取使用者帳號底下最新且真正活著的可用模型清單。
  - 設定視窗在模型輸入框右側新增 **「🔍 取得可用模型清單」** 按鈕與 `<datalist>` 自動完成選單，一鍵連線列出即時可用模型，徹底根絕模型被官方廢棄（Decommissioned）或寫死過期名稱的痛點。

### Changed / 改善與優化
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
