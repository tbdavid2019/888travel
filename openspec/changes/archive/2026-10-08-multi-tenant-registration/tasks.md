# Tasks: Multi-Tenant Architecture with Configurable Registration Toggle

## 1. Storage Partitioning & Auto-Migration

- [x] 1.1 Implement legacy single-user detection and auto-migration in `worker.js` (promoting existing `auth` and `store` to `usr_admin` and `store:usr_admin`), and verify existing itineraries remain intact.
- [x] 1.2 Implement tenant-scoped storage accessors (`loadTenantStore(env, uid)`, `saveTenantStore(env, uid, store)`) in `worker.js`, and verify separate tenants cannot read or overwrite each other's data.

## 2. Authentication, Session & Registration Control

- [x] 2.1 Implement `system:config` store schema with `allow_registration` boolean and admin route `POST /admin/config`, verifying that only the admin can modify the toggle.
- [x] 2.2 Implement `POST /auth/register` supporting password and Resend OTP registration flows, verifying it returns HTTP 403 when registration is closed and creates user record when open.
- [x] 2.3 Implement dynamic session tokens under `session:<token>` (mapping to `{ uid, email, role }`) with 30-day sliding TTL, replacing static hash cookies, and verify token issuance and revocation on logout.

## 3. Host Quota Defense & BYOK Protection

- [x] 3.1 Implement sliding cooldown and IP/email rate-limiting on `POST /auth/otp/send` in `worker.js`, verifying that requests within 60s return HTTP 429.
- [x] 3.2 Update `POST /ai/chat` in `worker.js` to inspect `user:<uid>:llm_config` for per-tenant BYOK credentials before using host defaults, verifying tenant-isolated AI billing.
- [x] 3.3 Add optional Cloudflare Turnstile bot verification on registration and OTP endpoints when `TURNSTILE_SECRET_KEY` is configured in Worker environment.

## 4. Frontend Registration & Admin Settings UI

- [x] 4.1 Update `travel-app.html` auth scrim with a tabbed "登入 (Login)" and "註冊 (Register)" interface, displaying real-time registration status and error handling.
- [x] 4.2 Add "開放註冊 (Allow Registration)" toggle switch and registered tenant summary into the Admin Settings modal in `travel-app.html`, rendered exclusively for the admin user.
- [x] 4.3 Scope frontend `localStorage` and `IndexedDB` cache keys to the active `uid` to eliminate cross-tenant data caching on shared family devices.

## 5. Verification & Mirroring

- [x] 5.1 Execute Canonical Mirror Rule (`cp travel-app.html public/app.html`) and verify 100% byte equality with `cmp`.
- [x] 5.2 Run V8 script syntax verification across `worker.js`, `travel-app.html`, and `public/app.html`.
- [x] 5.3 Conduct end-to-end multi-tenant lifecycle testing: admin boots -> toggles registration ON -> second user registers -> stores verify isolated -> admin toggles registration OFF -> third user registration rejected.
