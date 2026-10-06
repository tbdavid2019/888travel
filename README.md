# ✈️ 888漫步旅遊 · 888RoamTravel — 個人專屬雲端旅遊行程中樞

> **一個免費、開源、100% 個人自架的單頁式旅遊行程管理中心。**  
> 將所有航班、住宿、租車、交通接駁、倒數計時、願望清單與過往足跡整合在單一動態旅程時間軸。支援 Google 行事曆、Gmail 智慧解析（支援 Gemini / OpenAI / Groq / DeepSeek / Claude Haiku 等任意相容模型），以及 Resend 信箱 OTP 驗證碼登入。完全託管於您個人的 Cloudflare Worker 雲端帳戶，無須共用伺服器，資料隱私 100% 操之在己。  
> 
> *A free, open-source, self-hosted personal travel hub running entirely on your own Cloudflare Worker account. Original architecture by [Giovanni Brees](https://www.giovannibrees.com), enhanced with full Traditional Chinese (繁體中文) & English i18n, Universal OpenAI-compatible LLMs, Resend OTP Login, and CJK Craft Typography by [tbdavid2019](https://github.com/tbdavid2019).*

---

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-1E40FF.svg)](LICENSE)
![Self-hosted](https://img.shields.io/badge/self--hosted-yes-1B8A57.svg)
![Runs on Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-F38020.svg)
![i18n](https://img.shields.io/badge/i18n-繁體中文%20%7C%20English-blueviolet.svg)
![LLM Supported](https://img.shields.io/badge/LLM-Gemini%20%7C%20OpenAI%20%7C%20Groq%20%7C%20Claude-blue.svg)
![Resend OTP](https://img.shields.io/badge/Email%20Auth-Resend%20OTP-1B8A57.svg)
![PWA Ready](https://img.shields.io/badge/PWA-installable-success.svg)
![Vanilla JS](https://img.shields.io/badge/stack-Vanilla%20JS%20(No%20Build)-yellow.svg)

<p align="center">
  <img src="docs/screenshots/travel-demo.gif" alt="888漫步旅遊 介面展示：旅程卡片、年度行事曆與足跡世界地圖" width="340">
</p>

---

## 🧭 產品核心特色 (Core Highlights)

| 旅程一覽與在地情報 | 年度行事曆與離家天數 | 足跡地圖 (Been There) |
|:---:|:---:|:---:|
| ![旅程卡片包含相片、天氣預報、匯率、插座型號與緊急電話](docs/screenshots/tripcard.png) | ![全年度行事曆總覽與離家天數統計](docs/screenshots/calendar.png) | ![已造訪世界國家地圖與造訪次數統計](docs/screenshots/map.png) |

<sub>▲ 示範旅程卡片：系統會依目的地自動抓取代表相片、即時天氣預報、當地貨幣匯率與各國緊急救助電話。</sub>

---

## ✨ 完整功能清單 (Key Features)

### 🌐 全站雙語與在地化體驗 (Full i18n & Localized)
- **繁體中文 & English 一鍵無縫切換**：在頂部導覽列或「設定」視窗中隨時切換，全站文案即時更新，並自動於本地記憶偏好（`localStorage`）。
- **極致 CJK 字型排版工藝 (Impeccable Craft)**：全面針對繁體中文讀者優化字型備援與排版間距，徹底修正英文字型寬鬆字距（`.22em`）在方塊中文字上散亂的問題；為複雜筆劃漢字（如體、鑑、鐵、鬱）提供清晰的最小字級（12px~13px）與舒適行高（1.6~1.7）。
- **在地化日期與名詞**：符合台灣與繁體中文閱讀習慣的日期區間（如 `2026年 9月15日 – 9月18日`）、行程分類（航班、飯店住宿、租車、機場接駁、鐵路列車、餐廳活動）。

### 🔐 雙重認證守門：密碼登入與信箱 OTP 驗證碼 (Password & Email OTP)
- **密碼保護**：初次架設一鍵建立管理員信箱與密碼，產生 256 位元安全 Session。
- **Resend 一次性安全驗證碼 (Email OTP)**：整合 [Resend](https://resend.com) API，支援發送 6 位數一次性登入碼至您的管理員信箱。有效期限 10 分鐘，具備 60 秒冷卻重發與防暴力嘗試安全防護。

### 🤖 智慧自動匯入 (Universal LLM & Gmail Parsing)
- **多模型與 OpenAI 相容 LLM 支援**：全面支援 **Google Gemini**（`gemini-2.0-flash`）、**OpenAI**（`gpt-4o-mini`）、**Groq**（極速推論 `llama-3.3-70b`）、**DeepSeek**（`deepseek-chat`）、**Anthropic Claude**（`claude-haiku-4-5`）或任何自訂 OpenAI 相容 Base URL。
- **Google 日曆雙向串接**：自動讀取行程相關預訂，並在個人日曆上寫入整合旅程區塊。
- **「+trip」轉發必成備案**：無法自動辨識的小民宿或旅行社確認信，只需轉發給自己並在 `@` 前加上 `+trip`（例如 `you+trip@domain.com`），系統背景每小時定時排程自動解析歸檔。轉發飯店自動建立旅程，轉發機票自動建立跨期旅程。

### 📲 行動裝置與社交分享 (Mobile & Sharing)
- **PWA 原生級體驗**：可直接加入 iPhone / Android 主畫面，支援全螢幕沉浸式運行與離線檢視。
- **專屬旅伴唯讀分享 (Share Trip)**：在旅程中點擊即可複製獨立唯讀連結，同伴無須登入即可查看完整時刻表與飯店門禁資訊。
- **Instagram 限時動態 9:16 卡片**：一鍵產生適合社群分享的動態視覺卡片，截圖即發。
- **年度回顧 (Year Wrapped)**：以大字呈現年度旅行指標——總旅程數、離家天數、造訪國家與總飛行里程。
- **萬用日曆訂閱 (ICS Feed)**：提供可在 Apple 日曆、Google 日曆或 Outlook 中訂閱的私密 URL，隨時保持同步。
- **雲端每週自動快照 (Snapshots)**：每週日自動備份完整資料（保留 4 週），並在任何破壞性操作前保留副本，隨時一鍵秒級還原。

---

## 🚀 5 分鐘快速部署指南 (Deploy in ≈5 Mins, Free)

本專案運行於 Cloudflare 免費層（Free Plan 額度充裕），零主機伺服器費用。

### 方法 A：一鍵網頁部署（最推薦）

點擊下方按鈕，即可將專案複製到您的 GitHub 並直接建立 Cloudflare Worker 與 KV 資料庫：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tbdavid2019/travel-roamradar)

1. 點擊上方按鈕授權 Cloudflare 連線。
2. 系統會自動在您的 Cloudflare 帳戶建立 Worker 與 `TRIPS` KV 命名空間。
3. 部署完成後將獲得專屬網址（例如：`https://travel-roamradar.<your-subdomain>.workers.dev`）。
4. **立即開啟網址並設定帳號密碼**（首位註冊者即為管理員，請務必第一時間設定）。

---

### 方法 B：透過命令列 CLI 部署

若您熟悉終端機操作：

```bash
# 1. 複製儲存庫
git clone https://github.com/tbdavid2019/travel-roamradar.git
cd travel-roamradar

# 2. 安裝 Cloudflare Wrangler CLI 並登入
npm i -g wrangler
wrangler login

# 3. 建立 KV 命名空間
wrangler kv namespace create TRIPS

# 4. 將產生的 KV id 貼入 wrangler.toml
# [[kv_namespaces]]
# binding = "TRIPS"
# id = "貼於此處"

# 5. 發布至 Cloudflare Workers
wrangler deploy
```

---

## 📱 安裝至手機主畫面 (PWA 指引)

RoamRadar 是一套 Progressive Web App (PWA)。加入主畫面後即可全螢幕沉浸運行，享有原生 App 般的體驗：

### iPhone / iPad (Safari)
1. 在 **Safari** 瀏覽器中開啟您的專屬 App 網址（例如 `https://travel-roamradar.<you>.workers.dev/app`）。
2. 點擊瀏覽器下方的 **「分享」** 按鈕（向上箭頭方形圖示）。
3. 往下滑動並點選 **「加入主畫面」** (Add to Home Screen)。
4. 確認名稱為「RoamRadar 旅遊雷達」後點擊右上角 **「新增」**。
5. 點擊主畫面圖示開啟並登入一次，可保持登入狀態 30 天。

### Android (Chrome)
1. 在 **Chrome** 瀏覽器中開啟您的專屬 App 網址。
2. 點擊右上角選單圖示 **「⋮」**。
3. 點選 **「加到主畫面」** 或 **「安裝應用程式」**。
4. 確認安裝，即可從主畫面點擊開啟。

---

## ⚙️ 外部服務連接指引 (可選)

888漫步旅遊 本身支援純手動維護所有行程。如需開啟自動匯入或 OTP 郵件登入功能，可於 App 內的 **「設定 (Settings)」** 視窗進行設定，金鑰將直接安全儲存於您的 Cloudflare KV（或透過 Worker Secrets）：

- **Google 行事曆與 Gmail**：至 [Google Cloud Console](https://console.cloud.google.com/) 啟用 Calendar API 與 Gmail API，建立網頁版 OAuth 用戶端（App 設定視窗內會直接提供您需填寫的來源與重導向 URI）。貼上 Client ID 與 Secret 後點擊「連結 Google」即可。
- **多模型 LLM 智慧郵件解析 (Universal LLM)**：
  - 支援 **Google Gemini**、**OpenAI**、**Groq**、**DeepSeek**、**Anthropic Claude** 或 **自訂 OpenAI 相容服務**。
  - 在 App 設定的「郵件智慧解析」下拉選單中選擇提供者，系統將自動預填推薦之 Base URL 與模型名稱（例如 Gemini 預填 `gemini-2.0-flash`、OpenAI 預填 `gpt-4o-mini`、Groq 預填 `llama-3.3-70b`、Anthropic 預填 `claude-haiku-4-5`）。
  - 貼上您的 API Key 點擊「儲存 LLM 設定」即可。亦可透過 Worker Secrets 靜態配置：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_PROVIDER`。
- **Resend 郵件寄送與 OTP 驗證碼 (Email Delivery & OTP)**：
  - 至 [Resend](https://resend.com/api-keys) 免費建立 API Key（`re_...`）。
  - 貼入 App 設定內的「Resend API 金鑰」與「寄件者地址」（若未設定網域可直接使用預設 `888RoamTravel <onboarding@resend.dev>`）。
  - 點擊「發送測試郵件」確認連線成功，後續登入即可享受 6 位數免密碼 OTP 安全驗證碼！亦可透過 Worker Secrets 靜態配置：`RESEND_API_KEY`、`RESEND_FROM`。

---

## 🏗️ 專案架構與檔案配置 (Architecture)

本專案採用極簡無依賴設計，零建置步驟（No framework, no build step），維護性與響應速度極高：

```text
├── travel-app.html          # Web App 核心前端（單檔純 Vanilla JS，資料互動與介面渲染）
├── website/
│   └── index.html           # 官方形象宣傳首頁（含多語系即時切換字典）
├── public/                  # Cloudflare Workers Assets 鏡像目錄
│   ├── app.html             # travel-app.html 之正式發布鏡像
│   ├── index.html           # website/index.html 之正式發布鏡像
│   └── manifest.webmanifest # PWA 清單發布鏡像
├── worker.js                # Cloudflare Worker 核心伺服端（路由、密碼驗證、KV 同步、排程）
├── wrangler.toml            # Cloudflare Worker 組態與 Cron 排程定義
├── manifest.webmanifest     # PWA 應用程式清單原始檔
└── CHANGELOG.md             # 專案版本更新紀錄
```

> [!IMPORTANT]
> **鏡像維護原則 (Mirror Rule)**：  
> 當您修改根目錄的 `travel-app.html`、`website/index.html` 或 `manifest.webmanifest` 時，提交前必須執行對應的鏡像複製指令：
> ```bash
> cp travel-app.html public/app.html
> cp website/index.html public/index.html
> cp manifest.webmanifest public/manifest.webmanifest
> ```

---

## 🔒 隱私與安全性聲明 (Privacy & Security)

- **100% 個人專屬持有**：所有行程資料存放於您個人的 Cloudflare KV，Google 與 Anthropic 金鑰僅在伺服器端環境加密執行，絕不向前端回傳。
- **無共享伺服器**：沒有任何中心化雲端伺服器能存取您的旅程資料。
- **遙測已預設關閉**：本儲存庫中 `wrangler.toml` 內的 `TELEMETRY_URL` 預設為留空，絕不對外發送任何隱私連線。

---

## ❓ 常見問答 (FAQ)

**Q：RoamRadar 是免費的嗎？**  
A：是的。本專案為開源專案，且 Cloudflare Workers 的免費方案每日提供 100,000 次請求額度，個人使用完全無需任何主機費用。

**Q：是否支援繁體中文與多語系？**  
A：完整支援！介面提供「繁體中文」與「English」雙語即時切換，包含所有導覽、設定、表單、行程卡片與使用說明指南。

**Q：一定要串接 Google 帳號或 Anthropic 金鑰才能使用嗎？**  
A：完全不需要。RoamRadar 可以純手動輸入並管理所有旅程細項，第三方串接純粹是為了提供自動匯入的便利性。

---

## ❤️ 特別鳴謝與作者資訊 (Acknowledgments & Credits)

- **Original Creator (原作者)**：  
  誠摯感謝 **[Giovanni Brees](https://www.giovannibrees.com)** 開源打造出這套架構精巧、設計優雅的 RoamRadar 個人旅遊中樞！其在單租戶架構與 AI 代理人開發上的先驅實踐，為本專案奠定了最卓越的基礎。
  - 個人網站：https://www.giovannibrees.com
  - LinkedIn：https://www.linkedin.com/in/giovannibrees/
  - Podcast 節目《The Zero-Employee Company》：https://open.spotify.com/show/033TuF4FmEurDDvBZlOAYr

- **Traditional Chinese Localization & Maintenance (繁體中文在地化維護)**：  
  由 **[tbdavid2019](https://github.com/tbdavid2019)** 深度重構與維護，全面注入繁體中文多語系機制、在地化字型工藝與中文旅遊語境優化。

---

## 📄 開源授權 (License)

本專案遵循 [PolyForm Noncommercial 1.0.0](LICENSE) 授權條款：允許自由運行、修改並用於任何非商業性個人目的。
