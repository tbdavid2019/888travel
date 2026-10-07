# Proposal

## Why
While RoamRadar now offers an in-app LLM configuration (Groq, Gemini, DeepSeek, OpenAI, Anthropic) and a RESTful Agent API (`/api/v1`), users currently cannot interact with this LLM directly inside the web UI to discuss, plan, and adjust their travel itineraries. Users must copy prompts out to external tools or manually enter every detail by hand.

Adding an in-app AI Copilot chat drawer creates a seamless, human-in-the-loop planning experience: travelers can converse naturally about itinerary ideas, receive contextual suggestions, and review structured proposal cards (e.g. adding restaurants with backup alternatives) before applying them to their live timeline with a single click.

## What Changes
- **Backend AI Chat Gateway (`POST /ai/chat`)**: A secure Worker endpoint authenticated with the user's existing session, which loads the configured LLM settings and dispatches chat conversations with trip context, schema instructions, and structured proposal directives.
- **In-App AI Copilot UI (`travel-app.html` & `public/app.html`)**:
  - Global trigger button (`✨ AI 助理 / AI Copilot`) in top navigation and per-trip quick access button (`✨ AI 規劃此旅程`).
  - Slide-out Copilot drawer (desktop) and bottom sheet (mobile) maintaining visual side-by-side view with the travel timeline.
  - Contextual Quick Suggestion chips (e.g., "🍣 推薦附近人氣餐廳與備案", "🌧️ 安排雨天室內備案", "⏱️ 檢查今日行程時間節奏").
  - Thinking state indicator during LLM generation.
- **Interactive Proposal Action Cards (Human-in-the-Loop)**:
  - The assistant returns conversational responses along with structured JSON action proposals (create trip, add segments with fallback, update plan, delete plan).
  - The chat interface parses these proposals into high-contrast preview cards showing category badges, dates, venues, notes, and backup alternatives.
  - Users can review each proposal and click **"✓ 確認套用至行程 (Apply to Itinerary)"** or **"✕ 忽略 (Dismiss)"**.
  - Upon approval, the client immediately updates the local and KV store via existing save methods, enforcing `source: "manual"`.

## Capabilities

### New Capabilities
- `ai-copilot`: In-app conversational AI travel assistant with context-aware itinerary discussions, LLM gateway integration, and interactive proposal cards for 1-click timeline execution.

### Modified Capabilities
*(None. Existing `/api/v1` and `agent-integration-hub` specifications remain unchanged).*

## Impact
- **Backend**: `worker.js` adds `POST /ai/chat` utilizing `getLLMConfig(env)`.
- **Frontend**: `travel-app.html` adds slide-out drawer markup, responsive CSS, chat session state, message rendering, proposal card parser, and action executors.
- **Distribution**: `public/app.html` updated to maintain 100% byte equality per the Canonical Mirror Rule.
- **Dependencies & Storage**: Zero new external runtime dependencies. Operates entirely within existing Cloudflare Worker & KV infrastructure.
