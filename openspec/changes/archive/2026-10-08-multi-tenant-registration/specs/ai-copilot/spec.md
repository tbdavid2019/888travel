# Spec Delta: ai-copilot

## MODIFIED Requirements

### Requirement: Backend AI Chat Gateway
The system SHALL provide an authenticated `POST /ai/chat` endpoint that routes user messages and travel context to the user's configured LLM provider (Groq, Gemini, DeepSeek, OpenAI, Anthropic, or custom), resolving tenant-specific BYOK credentials when available and falling back to host defaults for admin.

#### Scenario: Authenticated chat request with trip context
- **WHEN** an authenticated user sends `POST /ai/chat` with message history and active trip details
- **THEN** the system SHALL invoke the configured LLM with travel hub system instructions and return the assistant response containing conversational text and optional structured proposals

#### Scenario: Sliced Trip Context Injection
- **WHEN** an authenticated user invokes `POST /ai/chat` with `currentTripId`
- **THEN** the system SHALL serialize active trip metadata and a minified segment list (`[start] type: name (note)`), excluding internal identifiers and bulky metadata to preserve model token limits

#### Scenario: Global Context Fallback
- **WHEN** an authenticated user invokes `POST /ai/chat` without `currentTripId`
- **THEN** the system SHALL provide a concise summary of upcoming trips (ID, Destination, Dates) to the assistant instructions

#### Scenario: Tenant BYOK Key Resolution
- **WHEN** an authenticated tenant calls `POST /ai/chat` and has a BYOK configuration in `user:<uid>:llm_config`
- **THEN** the system SHALL route the request using the tenant's personal API credentials

#### Scenario: Unconfigured LLM provider returns descriptive guidance
- **WHEN** a user invokes `POST /ai/chat` before configuring an LLM API key in Settings and no host fallback is granted
- **THEN** the system SHALL return HTTP 400 with error code `NO_LLM_KEY` instructing the user to configure an LLM key in Settings
