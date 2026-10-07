# Proposal

## Why
Users frequently use external AI agents (e.g., ChatGPT, Claude Projects, Cursor, autonomous travel planning agents, and OpenSpec/Codex/Antigravity workflows) to conduct complex, multi-destination travel research, ticket comparison, and schedule synthesis. Currently, RoamRadar requires manual entry or email forward ingestion, lacking a direct programmatic API and standardized AI agent skills. Providing a dedicated API token, RESTful CRUD endpoints, `llms.txt`, and an exportable `SKILL.md` enables external AI agents to push structured travel plans directly into the user's living timeline in seconds.

## What Changes
- **Agent API Authentication**: Introduce dedicated personal Agent API Keys (prefixed with `rr_agent_...`) with Bearer token authentication, stored securely in Cloudflare KV without exposing instance admin passwords.
- **RESTful Agent CRUD Endpoints (`/api/v1`)**:
  - `GET /api/v1/trips` - List all trips with summary stats and timezone context.
  - `POST /api/v1/trips` - Create or upsert a trip with dates, origin, destination, and initial itinerary.
  - `GET /api/v1/trips/:id` - Fetch full trip details including segments, fallback plans, and places metadata.
  - `PUT /api/v1/trips/:id` - Update trip header, dates, notes, or cover photo.
  - `DELETE /api/v1/trips/:id` - Delete a trip.
  - `POST /api/v1/trips/:id/segments` - Add an itinerary segment (flight, hotel, restaurant, car, ride, rail, other) with optional fallback plans.
  - `PUT /api/v1/trips/:id/segments/:sid` - Update an existing segment.
  - `DELETE /api/v1/trips/:id/segments/:sid` - Delete a segment.
- **Machine-Readable LLM Discovery (`/llms.txt` & `/api/llms.txt`)**:
  - Expose standardized `llms.txt` and `llms-full.txt` describing the API schema, data invariant rules (e.g. manual source preservation), segment categories, and validation rules.
- **Exportable Agent Skill (`SKILL.md`)**:
  - Provide a production-grade `SKILL.md` following standard agent skill specs that can be imported directly into Antigravity, Claude Code, Cursor, Codex, or OpenAI Custom GPTs.
- **In-App Agent Integration Hub (Settings)**:
  - Settings UI section to generate, view, copy, or revoke personal Agent API keys.
  - One-click copy for Agent System Prompt (with user-specific instance URL and active API key embedded).
  - One-click download/copy for `SKILL.md` and direct links to `/llms.txt`.

## Capabilities

### New Capabilities
- `agent-api`: Programmatic REST API endpoints with Bearer token authentication enabling external AI agents to perform full CRUD operations on trips and itinerary segments.
- `agent-integration-hub`: In-app Settings interface and metadata endpoints for personal agent API key management, copyable agent prompt templates, `llms.txt` specification, and exportable `SKILL.md`.

### Modified Capabilities
*(None; this change adds new programmatic surfaces without breaking existing web app UI, calendar sync, or email ingestion requirements.)*

## Impact
- **Backend (`worker.js`)**: Adds `/api/v1/*` routes, `/llms.txt`, `/api/llms.txt`, `/skill.md`, API key generation/revocation in KV, and Bearer token middleware.
- **Frontend (`travel-app.html` & `public/app.html`)**: Adds "AI Agent 開發與整合 (AI Agent Integration)" section in Settings modal with API key generation, prompt template generator, and skill copy/download buttons.
- **Public Assets (`website/index.html` & `public/index.html`)**: Adds mention of open agent API and `llms.txt` support.
- **Dependencies**: Zero new dependencies; pure Cloudflare Workers vanilla JavaScript and KV storage.
