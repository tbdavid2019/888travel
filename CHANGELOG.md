# Changelog / 更新日誌

All notable changes to this project will be documented in this file.
本專案的所有重要變更均會記錄於此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- **清理開發者指令檔**：
  - 刪除 `CLAUDE.md`，將專案架構說明與鏡像維護守則統整收錄於 `README.md`。

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
