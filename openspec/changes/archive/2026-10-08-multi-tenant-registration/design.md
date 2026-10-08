# Design: Multi-Tenant Architecture with Registration Gate

## Context

888travel currently operates as a single-tenant Cloudflare Worker with a single Cloudflare KV namespace (`TRIPS`). The entire state resides in singleton KV keys: `store` (trips JSON), `auth` (SHA-256 password hash), and `auth_email` (admin email). 

This design establishes a partitioned multi-tenant data architecture while preserving the project's zero-build, pure vanilla JavaScript philosophy and serverless edge execution model.

## Goals / Non-Goals

**Goals:**
- **Strict Data Isolation**: Separate all trips, segments, notes, and preferences per user (`store:<uid>`).
- **Dynamic Registration Switch**: Allow the system administrator to toggle registration (`allow_registration`) on or off via the in-app UI.
- **Cost & Abuse Protection**: Isolate AI token consumption via per-tenant Bring-Your-Own-Key (BYOK) settings and rate-limit transactional OTP emails.
- **Seamless Backward Compatibility**: Existing single-user deployments must auto-migrate to the `admin` tenant on first boot without manual intervention.

**Non-Goals:**
- Complex multi-level enterprise organizational hierarchies (only `admin` and `user` roles are supported).
- Commercial SaaS billing, subscription tiers, or payment gateway integration.
- Moving from Cloudflare KV to relational SQL databases (D1/Postgres) at this stage.

## Decisions

### 1. Storage Partitioning via Cloudflare KV Key Namespaces

*Decision:* Use structured key prefixes in the existing `TRIPS` KV namespace:
- `system:config`: Global instance configuration `{ allow_registration: boolean, admin_email: string, shared_ai_pool: boolean }`
- `user:by_email:<normalized_email>`: Maps email to user record `{ uid, email, passwordHash, role: 'admin'|'user', status: 'active'|'disabled', createdAt }`
- `user:by_id:<uid>`: Reverse pointer to email metadata
- `store:<uid>`: The user's complete itinerary store document
- `session:<token>`: Active sessions `{ uid, email, role, expiresAt }` with 30-day KV TTL
- `user:<uid>:llm_config`: User-specific BYOK AI credentials

*Rationale:* Avoids introducing Cloudflare D1 or breaking the current `wrangler.toml` binding. KV per-key write limits (1 write/sec) are mitigated because writes are distributed across unique `store:<uid>` keys.

*Alternatives Considered:* Cloudflare D1 (SQLite). While D1 is powerful for relational joins, keeping KV maintains 100% compatibility with existing self-hosted templates and requires zero schema migration steps for users.

### 2. Session Token Architecture over Static Hash Cookies

*Decision:* Replace the static password hash in `tk` cookie with dynamic cryptographically random 256-bit session tokens stored under `session:<token>`.

*Rationale:* In a multi-user environment, static credential cookies prevent revocation and cannot safely carry tenant identity across multiple devices. A dynamic KV session allows instant logout, administrative session revocation, and clean role propagation.

### 3. Tenant AI Expense Protection via BYOK (Bring Your Own Key)

*Decision:* In multi-tenant mode, standard users must provide their own LLM API key in Settings (or use admin-sanctioned shared pool if explicitly enabled).
- When a user calls `POST /ai/chat`, the Worker inspects `user:<uid>:llm_config`.
- If configured, the tenant's own key is utilized.
- If not configured, and `shared_ai_pool` is false, the system returns `NO_LLM_KEY` with visual onboarding guidance.

*Rationale:* Prevents public or guest users from exhausting the host's personal API quota or incurring unexpected credit card charges.

### 4. Resend OTP Flood Protection

*Decision:* Enforce multi-tier rate limiting on `POST /auth/otp/send`:
- Sliding cooldown: 60 seconds per email (`otp_cd:<email>`).
- Daily cap: maximum 5 verification requests per hour per IP/email.
- Optional Turnstile verification: if `TURNSTILE_SECRET_KEY` is set in Worker environment, require client Turnstile token validation on registration.

## Risks / Trade-offs

- **[Risk] Host Resource Contention on Shared KV**: Multiple users writing simultaneously could approach free-tier KV limits (1,000 writes/day).  
  *Mitigation:* The frontend employs local IndexedDB/localStorage write-through caching, only debouncing remote persistence on explicit trip saves.
- **[Risk] Accidental Open Registration**: An instance owner might inadvertently leave registration open.  
  *Mitigation:* Registration is `false` by default on new setups and migrations; the admin UI displays a prominent warning indicator when registration is actively open.
- **[Risk] Single-User Migration Regression**: Existing user cannot log in after multi-tenant update.  
  *Mitigation:* The migration script detects legacy `auth` and `auth_email`, automatically promotes them to `uid: "admin"`, and preserves legacy password hash verification as a fallback login path.

## Migration Plan

1. **Step 1 (Auto-Bootstrap)**: On Worker start, if `system:config` is missing but `auth` exists:
   - Mint admin UID `usr_admin_01`.
   - Write `system:config` with `allow_registration: false` and `admin_email: storedEmail`.
   - Write `user:by_email:<storedEmail>` with `role: "admin"`.
   - Copy `store` to `store:usr_admin_01`.
2. **Step 2 (Zero Downtime)**: Single-user instances continue running without user disruption; existing session cookies seamlessly re-authenticate.
