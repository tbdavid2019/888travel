# Proposal: Multi-Tenant Architecture with Configurable Registration Toggle

## Why

888travel is currently a strict single-tenant personal hub where only the initial instance creator can log in, and all travel data is saved in a single singleton document (`store`). Enabling multi-tenancy with a dynamic "Allow Registration" toggle allows the instance owner to selectively open registration for family, companions, or community members without exposing personal travel itineraries or risking unintended resource exploitation.

## What Changes

- **User Identity & Namespace Isolation**: Migrate storage from single-document `store` to tenant-partitioned namespaces (`store:<uid>`), while retaining automatic migration for existing single-user data.
- **Configurable Registration Gate**: Introduce an admin-managed `system:config` key containing `allow_registration: boolean`, with a visual toggle switch in the admin Settings panel.
- **Registration & Session Endpoints**:
  - Add `POST /auth/register` to create accounts via password or email OTP when registration is active; reject with `403 Forbidden` when closed.
  - Upgrade session handling to issue user-scoped session tokens (`session:<token>` mapping to `{ uid, email, role }`) with 30-day sliding TTL.
- **Role-Based Access Control (RBAC)**: Distinguish between `admin` (the first configured email, granted registration toggling and tenant management) and standard `user` tenants.
- **Host Cost & Quota Defense (BYOK & Rate Limiting)**:
  - Add per-tenant BYOK (Bring Your Own Key) for AI Copilot in multi-user mode so secondary users do not consume the host's LLM credits.
  - Enforce IP and email rate limiting on `POST /auth/otp/send` to protect Resend free-tier email quotas.
- **Frontend Registration UI**: Add "Register" mode to the auth scrim in `travel-app.html`, displaying clear registration status feedback and tenant indicator.

## Capabilities

### New Capabilities
- `multi-tenant-auth`: User registration, tenant store isolation (`store:<uid>`), user-scoped sessions, and admin-controlled registration toggle (`allow_registration`).
- `tenant-quota-protection`: Host expense defense including per-tenant BYOK LLM key storage and strict rate limiting on transactional OTP dispatches.

### Modified Capabilities
- `ai-copilot`: Tenant-aware credential resolution in `POST /ai/chat`, utilizing the calling user's BYOK LLM configuration when available.

## Impact

- **Backend (`worker.js`)**: Modifies auth middleware, `/trips`, `/settings`, `/ai/chat`, `/sync`, and cron workers to be user-scoped; adds registration and tenant management routes.
- **Frontend (`travel-app.html`)**: Updates auth modal with registration tabs/forms, adds admin system configuration section, and scopes client-side caching to authenticated user ID.
- **Backward Compatibility**: Fully preserves existing single-user deployments by auto-migrating existing `auth` and `store` to `uid: "admin"` with zero data loss.
