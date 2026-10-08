# AGENTS.md · AI Agent Guidelines & Architecture Manual

> This document defines the engineering standards, architecture, data schemas, mirror rules, and development guidelines for AI agents (Antigravity, Claude, Cursor, Copilot, etc.) working on the **888travel** (888漫步旅遊, formerly RoamRadar) codebase.

---

## 1. Project Overview & Philosophy

**888travel** (888漫步旅遊) is a personal travel hub designed for a single user per instance:
- **Zero build step, zero heavy frameworks**: The frontend is pure Vanilla HTML5, CSS3, and JavaScript.
- **Headless serverless backend**: Runs as a single Cloudflare Worker using Cloudflare KV for persistence.
- **Single-tenant & privacy-first**: Every user self-hosts their own instance on their own Cloudflare account behind their own password gate.
- **Multi-language (i18n)**: Fully bilingual in **繁體中文 (Traditional Chinese, `zh-TW`)** and **English (`en`)**.

---

## 2. Repository File Structure & The Canonical Mirror Rule

```text
├── travel-app.html          # [CANONICAL] Core Web App UI
├── website/
│   └── index.html           # [CANONICAL] Marketing Landing Page
├── manifest.webmanifest     # [CANONICAL] PWA Manifest
├── public/                  # [DISTRIBUTION] Served by Cloudflare Workers Assets
│   ├── app.html             # Mirror of travel-app.html
│   ├── index.html           # Mirror of website/index.html
│   └── manifest.webmanifest # Mirror of manifest.webmanifest
├── worker.js                # Cloudflare Worker backend (API, Auth, KV, Cron, Sync)
├── wrangler.toml            # Cloudflare Worker configuration
├── README.md                # User-facing documentation (Traditional Chinese & English)
├── CHANGELOG.md             # Version history and release notes
└── AGENTS.md                # Agent instruction manual (this file)
```

### ⚠️ The Mirror Rule (CRITICAL)
Cloudflare Workers serves static assets from `./public` via `[assets]`:
- `/` serves `public/index.html` (Website)
- `/app` serves `public/app.html` (App)
- `/manifest.webmanifest` serves `public/manifest.webmanifest`

**Agents must ALWAYS edit the CANONICAL files first, and immediately mirror them before committing:**
```bash
cp travel-app.html public/app.html
cp website/index.html public/index.html
cp manifest.webmanifest public/manifest.webmanifest
```
*Never edit files in `public/` directly without modifying the canonical root files.*

---

## 3. Data Model & Invariant Rules

### Trip Schema
```typescript
interface Trip {
  id: string;              // Unique identifier (UUID or timestamp-based UID)
  from: string;            // Origin IATA or city (e.g., "TPE", "OPO")
  to: string;              // Destination IATA or city (e.g., "NRT", "FNC")
  start: string;           // Start date (YYYY-MM-DD)
  end: string;             // End date (YYYY-MM-DD)
  label: string;           // Trip title / label (e.g., "Tokyo Autumn")
  notes: string;           // Free-text notes
  segments: Segment[];     // Embedded itinerary items
  photo?: string;          // Custom photo URL or blank for auto-destination photo
  calEventId?: string;     // Synced Google Calendar event ID
  updatedAt?: number;      // Epoch millisecond timestamp
}
```

### Segment Schema
```typescript
interface Segment {
  sid: string;             // Unique segment ID
  source: "manual" | "calendar" | "gmail";
  type: "flight" | "hotel" | "car" | "ride" | "rail" | "other";
  name: string;            // Plan title (e.g., "BR198 TPE to NRT", "Hotel Gracery")
  address?: string;        // Location, address, or route
  start?: string;          // Start date or datetime
  end?: string;            // End date or datetime
  conf?: string;           // Confirmation / booking reference number
}
```

### 🛡️ Invariant Rules
1. **Manual Plans are Sacred**: Any plan with `source: "manual"` was entered by the user by hand. **No background sync, Google sync, or Gmail AI parsing may EVER overwrite, modify, or delete a manual plan.**
2. **Deduplication**: Ingested segments from Calendar/Gmail deduplicate strictly by `conf` or signature hash.
3. **Data Layer Purity**: Internal string literals (`"flight"`, `"hotel"`, `"manual"`, `"calendar"`) must **NEVER** be translated in the data store. Only the UI display layer performs localization.

---

## 4. Multi-language (i18n) Standards

- **Supported Languages**: `zh-TW` (繁體中文, default) and `en` (English).
- **Persistence**: User preference is saved in `localStorage.getItem("travel:lang")`.
- **Typography & Font Stack**:
  Primary Latin and Monospace: `JetBrains Mono`; Traditional Chinese: `Noto Sans TC` (Google Fonts), followed by CJK system font-stack fallback:
  ```css
  font-family: 'JetBrains Mono', 'Noto Sans TC', -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", monospace, sans-serif;
  ```
- **Terminology Consistency**:
  - `Upcoming` ➡️ `即將啟程`
  - `Past` ➡️ `歷史回憶`
  - `Been there` ➡️ `足跡地圖`
  - `Where I’m headed` ➡️ `我的行程方向`
  - `Calendar` ➡️ `行事曆總覽`
  - `Plans / Itinerary` ➡️ `細項規劃 / 行程規劃`
  - `Snapshots` ➡️ `雲端自動快照`
  - `Calendar feed` ➡️ `日曆訂閱網址 (ICS)`

---

## 5. Backend Architecture (`worker.js`)

- **Routing**:
  - `GET /trips`: Returns all trips from KV.
  - `POST /trips`: Upserts a trip, merging manual segments with synced segments.
  - `POST /sync`: Pulls events from Google Calendar and recent confirmation emails from Gmail.
  - `POST /auth/login`, `POST /auth/logout`, `GET /auth/status`: Single-user email + password session management.
  - `POST /ics/token` & `GET /cal.ics`: Private subscribed calendar feed.
  - `POST /trips/share`: Generates temporary or persistent read-only companion link.
- **Crons**:
  - Hourly: Scans Gmail for new `+trip` forwarded bookings.
  - Daily (18:00 UTC): Full Calendar + Gmail synchronization.
  - Weekly (Sunday): Full KV data snapshot backup (retaining last 4 weeks).

---

## 6. Development & Verification Rules for Agents

1. **No Secrets in Source Code**:
   - Local dev secrets must live in `.dev.vars` (must remain gitignored).
   - Production secrets configured exclusively via `wrangler secret put` (`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.).
2. **Pre-Commit Verification**:
   - Always run a JavaScript syntax validation test on inline `<script>` tags across all HTML files before committing:
     ```bash
     node -e "
     const fs = require('fs'), vm = require('vm');
     ['travel-app.html', 'public/app.html'].forEach(f => {
       const scriptMatch = fs.readFileSync(f, 'utf8').match(/<script>([\s\S]*?)<\/script>/);
       new vm.Script(scriptMatch[1]);
     });
     console.log('Syntax OK');
     "
     ```
   - Ensure the Mirror Rule holds with 100% byte equality:
     ```bash
     cmp travel-app.html public/app.html && cmp website/index.html public/index.html && cmp manifest.webmanifest public/manifest.webmanifest
     ```
3. **Commit Messages**:
   - Follow Conventional Commits (`feat(i18n): ...`, `fix(ui): ...`, `docs: ...`, `chore: ...`).
   - Keep `CHANGELOG.md` updated with notable changes under the current release header.
