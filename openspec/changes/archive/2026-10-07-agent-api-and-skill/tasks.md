# Tasks

## 1. Agent API Key Infrastructure & Authentication (`worker.js`)

- [x] 1.1 Update `cors()` helper in `worker.js` to allow `PUT`, `DELETE` methods and `Authorization` header, and implement `rr_agent_...` Bearer token authentication scoped strictly to `/api/v1/*` routes.
- [x] 1.2 Implement `/settings/agent-key` management endpoints (GET status, POST generate/regenerate, DELETE revoke), verifying key updates in KV store.

## 2. RESTful Agent Endpoints for Trips CRUD (`worker.js`)

- [x] 2.1 Implement `GET /api/v1/trips` and `GET /api/v1/trips/:id` with summary metrics and timezone metadata, verifying valid JSON responses.
- [x] 2.2 Implement `POST /api/v1/trips` and `PUT /api/v1/trips/:id` with date normalization, timezone assignment, and automatic ID minting, verifying trip upsertion.
- [x] 2.3 Implement `DELETE /api/v1/trips/:id`, verifying trip removal from KV and response `{ "ok": true }`.

## 3. RESTful Agent Endpoints for Segments & Fallback Plans (`worker.js`)

- [x] 3.1 Implement `POST /api/v1/trips/:id/segments` supporting both single objects and batch arrays for all 7 categories (`flight`, `hotel`, `restaurant`, `car`, `ride`, `rail`, `other`), date sanitization (`YYYY-MM-DD`), and `fallback` metadata, verifying segments are appended with `source: "manual"`.
- [x] 3.2 Implement `PUT /api/v1/trips/:id/segments/:sid` and `DELETE /api/v1/trips/:id/segments/:sid` with tombstoning in `store.deletedSegs`, verifying segment edits and deletions preserve existing confirmations and prevent sync resurrection.

## 4. Machine-Readable Discovery (`llms.txt` and `SKILL.md`)

- [x] 4.1 Position public routes before `authGuard` and create canonical `llms.txt` and `llms-full.txt` documenting schemas, invariant rules, and endpoint specifications.
- [x] 4.2 Create canonical `SKILL.md` (RoamRadar Travel Hub Agent Skill) with YAML frontmatter, tool definitions, batch guidelines, and route `GET /skill.md`.

## 5. In-App Settings UI for Agent Integration (`travel-app.html` & `public/app.html`)

- [x] 5.1 Add "AI Agent 開發與整合 (AI Agent Integration)" section in Settings modal with API key generation, active key display, copy, and revocation controls.
- [x] 5.2 Add "複製 Agent 提示詞 (Copy Agent Prompt)" button with dynamic pre-filled instance URL, active Bearer token, and trip/segment JSON schemas.
- [x] 5.3 Add "下載 / 複製 SKILL.md" button and links to `/llms.txt` in Settings modal, verifying clipboard copy feedback.
- [x] 5.4 Mirror canonical `travel-app.html` to `public/app.html` and verify 100% byte equality with `cmp`.

## 6. Verification & Deployment

- [x] 6.1 Execute an automated end-to-end integration test creating a sample multi-day trip with batch flights, hotel, restaurant, and fallback plan via curl, verifying data appears on the web timeline.
- [x] 6.2 Deploy the Worker to Cloudflare via `npx wrangler deploy`, verify live endpoints on `travel.david888.com`, and commit to Git.
