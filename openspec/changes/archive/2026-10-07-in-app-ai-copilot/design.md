# Design

## Context
RoamRadar provides a single-tenant travel planning hub with persistence in Cloudflare KV. The system recently added a RESTful `/api/v1` API and multi-provider LLM settings (supporting Gemini, Groq, DeepSeek, OpenAI, Anthropic, or any OpenAI-compatible base URL). Currently, this LLM configuration is only utilized for passive background email parsing. Users have no in-app conversational interface to ask questions, explore dining/sightseeing recommendations, or adjust their itineraries interactively.

See `proposal.md` for user motivations and high-level requirements.

## Goals / Non-Goals

**Goals:**
- Provide a responsive in-app AI Copilot chat drawer accessible across both desktop and mobile viewports.
- Route chat conversations securely through a dedicated `POST /ai/chat` Worker endpoint utilizing the user's existing LLM settings.
- Implement a **Human-in-the-Loop** proposal architecture: LLMs return natural conversational guidance alongside structured JSON action blocks (`:::proposal ... :::`), which render as visual interactive cards with 1-click confirmation.
- Inject active trip context (destination, dates, timezone, and current segments) dynamically into conversation turns so the assistant gives grounded, relevant advice.
- Enforce the invariant rule: all segments applied via the Copilot are stamped with `source: "manual"`, preventing background sync overwriting.

**Non-Goals:**
- Autonomous silent execution without user review (the user must explicitly approve any itinerary modification).
- Persistent multi-week chat history storage in KV (chat sessions are maintained in client memory / session state to minimize KV write amplification and cost).
- Custom client-side LLM SDKs (uses pure fetch and vanilla DOM manipulation).

## Decisions

### Decision 1: Human-in-the-Loop Proposal Cards vs Autonomous Function Calling
- **Choice**: Structure the system prompt so the LLM outputs conversational dialogue plus structured proposal blocks (`:::proposal { ... } :::`), which the frontend renders as interactive cards with `[✓ 確認套用]` and `[✕ 忽略]`.
- **Rationale**:
  1. Universal compatibility: Works consistently across all LLMs (Groq, Gemini, DeepSeek, OpenAI, Anthropic) without relying on vendor-specific Tool Calling APIs.
  2. Psychological safety: Users retain 100% control over their itinerary and can review date, time, venue, and fallback details before anything is written to their timeline.
  3. Seamless UI feedback: When the user confirms, the timeline updates instantly via existing client-side store logic.
- **Alternative considered**: Direct server-side tool execution (rejected due to unpredictability and varied provider tool support).

### Decision 2: Slide-Out Drawer (Desktop) & Bottom Sheet (Mobile)
- **Choice**: Implement the Copilot as a right-hand sliding panel (`width: 420px; max-width: 100%`) on desktop and a sliding bottom sheet on mobile screens.
- **Rationale**: Keeps the user's travel timeline visible and interactive on desktop while chatting, reducing cognitive load and allowing instant visual confirmation when items are applied.
- **Alternative considered**: Full-screen modal (rejected because it obscures the user's timeline view).

### Decision 3: Context Injection Strategy & TPM Protection
- **Choice**: The client sends `{ messages: [...], currentTripId: "..." }`, enforcing a client-side 10-message sliding window. The Worker loads only the active trip's metadata and minifies its segments into a concise line-based representation:
  ```text
  [{start}] {type}: {name} ({note}) [Location: {address}]
  ```
  Bulky internal fields (`sid`, `source`, `placeId`, raw maps URLs) are omitted. When `currentTripId` is omitted, the Worker injects a compact catalog of upcoming trips: `[ID] Destination (Start to End)`.
- **Rationale**: Passing a sliced, minified context dramatically cuts token usage (crucial for Groq TPM rate limits), reduces latency, and prevents cross-trip hallucinations while staying strictly within model token budgets.

### Decision 4: Safe Ergonomics, Mobile Viewport & XSS Defense
- **Choice**:
  1. **Mobile Ergonomics**: Copilot bottom sheet uses `height: 85dvh; max-height: 85dvh; overscroll-behavior: contain;` with `padding-bottom: env(safe-area-inset-bottom);` to prevent iOS viewport jumping and background page pull-to-refresh scrolling.
  2. **Proposal Parser Resilience**: The client-side parser tolerates markdown code fences (e.g. ```` ```json ````), strips trailing commas, handles multiple proposal blocks in one response, and disables apply buttons immediately upon click to prevent double-execution.
  3. **Strict XSS Sanitization**: All content rendered in conversational bubbles and proposal cards is filtered through `esc()` HTML escaping. External URLs are validated for `https://` protocol and given `rel="noopener noreferrer"`.
  4. **Error Protocol**: Structured error codes (`NO_LLM_KEY`, `PROVIDER_ERROR`, `RATE_LIMITED`) allow the frontend to display tailored UI actions (e.g. a 1-click button to open Settings for `NO_LLM_KEY`).

## Risks / Trade-offs

- **[Risk: Model outputs invalid JSON in proposal block]** → *Mitigation: Frontend strips markdown code fences, uses safe JSON parse with fallback, and continues rendering raw conversational text if proposal parsing fails.*
- **[Risk: User has not configured an LLM key yet]** → *Mitigation: Worker returns `{ error: 'NO_LLM_KEY' }`; frontend renders a friendly card with a direct shortcut button opening Settings -> LLM configuration.*
- **[Risk: Duplicate plan addition if user clicks apply multiple times]** → *Mitigation: Proposal card buttons disable immediately upon first click, enter a pending state, and transition permanently to `[✓ 已套用 / Applied]`.*
- **[Risk: High token consumption exceeding rate limits]** → *Mitigation: 10-message sliding window on client and line-based minified segment context in Worker.*

## Migration & Rollout Plan
1. Implement `POST /ai/chat` in `worker.js` with unified LLM dispatcher and trip context injector.
2. Build Copilot drawer HTML, CSS, and interaction logic in `travel-app.html`.
3. Mirror to `public/app.html` and verify Canonical Mirror Rule with `cmp`.
4. Deploy to Cloudflare Worker and test with live queries across active trips.
