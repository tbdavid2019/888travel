# Tasks

## 1. Backend AI Chat Gateway (`worker.js`)

- [x] 1.1 Implement `POST /ai/chat` endpoint in `worker.js` with authentication validation, resolving active trip metadata and segments to inject into the travel hub assistant context.
- [x] 1.2 Implement the multi-provider LLM dispatcher supporting Anthropic and OpenAI-compatible endpoints (Gemini, Groq, DeepSeek, OpenAI), returning assistant responses with structured proposal blocks (`:::proposal ... :::`).
- [x] 1.3 Implement trip context minification (`[{start}] {type}: {name} ({note}) [Location: {address}]`), token protection, and standard error codes (`NO_LLM_KEY`, `PROVIDER_ERROR`, `RATE_LIMITED`).

## 2. In-App Copilot Drawer Interface & Styles (`travel-app.html`)

- [x] 2.1 Add responsive Copilot drawer markup and CSS in `travel-app.html` (sliding right-side panel on desktop, sliding bottom sheet on mobile, warm editorial theme, message history area, and input bar).
- [x] 2.2 Add global `✨ AI 助理` navigation button and trip card `✨ AI 規劃此旅程` action buttons, wiring open/close events with active trip context binding.
- [x] 2.3 Implement mobile viewport touch ergonomics (`height: 85dvh`, `overscroll-behavior: contain;`, `env(safe-area-inset-bottom)`), preventing background scroll and keyboard jumping on iOS.

## 3. Conversational Messaging & Quick Chips (`travel-app.html`)

- [x] 3.1 Implement client-side chat manager handling conversation state, 10-message sliding window, user message rendering, smooth auto-scrolling, thinking animation indicator, and Quick Suggestion chips.
- [x] 3.2 Wire message dispatching to `POST /ai/chat` with auth tokens, handling unconfigured LLM state by providing a direct shortcut to Settings.

## 4. Interactive Proposal Action Cards & 1-Click Execution (`travel-app.html`)

- [x] 4.1 Implement the proposal card parser to extract structured actions (`add_segments`, `create_trip`, `update_segment`) and render high-contrast interactive preview cards with category badges and fallback alternatives.
- [x] 4.2 Implement action execution handlers for "✓ 確認套用至行程" and "✕ 忽略", persisting approved items to KV with `source: "manual"` and updating the timeline immediately.
- [x] 4.3 Implement proposal parser resilience (tolerate code fences ```` ```json ````, strip trailing commas) and strict XSS sanitization (`esc()`) on all LLM-generated text and fields.

## 5. Canonical Mirror & Pre-Commit Verification

- [x] 5.1 Mirror canonical `travel-app.html` to `public/app.html` and verify 100% byte equality with `cmp`.
- [x] 5.2 Execute Node VM script syntax validation across inline `<script>` tags.

## 6. End-to-End Verification & Deployment

- [x] 6.1 Execute an end-to-end verification test asking the AI assistant for recommendations, receiving a structured proposal with fallback, and applying it to the trip timeline.
- [x] 6.2 Deploy Worker to Cloudflare via `npx wrangler deploy`, verify live on `travel.david888.com`, update `CHANGELOG.md`, and commit to Git.
