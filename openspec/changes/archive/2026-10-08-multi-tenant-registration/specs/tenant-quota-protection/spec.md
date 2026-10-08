# Spec Delta: tenant-quota-protection

## Purpose

Protects host operating resources and third-party API quotas by providing Bring-Your-Own-Key (BYOK) configurations and rate limiting on transactional email endpoints.

## ADDED Requirements

### Requirement: Per-Tenant BYOK AI Key Configuration
The system SHALL allow individual registered tenants to configure their own LLM API keys and model preferences stored in `user:<uid>:llm_config`.

#### Scenario: Tenant configures personal LLM key
- **WHEN** an authenticated user saves an API key via `POST /settings/llm`
- **THEN** the system persists the credentials under `user:<uid>:llm_config` without altering host global secrets

#### Scenario: Tenant with BYOK executes AI queries
- **WHEN** a tenant with personal LLM credentials issues an AI Copilot query
- **THEN** the request is dispatched using the tenant's key instead of the host's default environment secrets

### Requirement: Email Rate Limiting and Flood Protection
The system SHALL enforce rate limits on `POST /auth/otp/send` and registration to prevent exhaustion of Resend email quotas.

#### Scenario: Cooldown between OTP requests
- **WHEN** an email address requests an OTP within 60 seconds of a previous request
- **THEN** the system rejects the request with HTTP 429 and a cooldown warning

#### Scenario: Daily email cap per tenant
- **WHEN** requests from a single IP or email exceed the hourly threshold of 5 requests
- **THEN** the system blocks further attempts for 1 hour to prevent email spamming

### Requirement: Optional Cloudflare Turnstile Verification
The system SHALL verify Cloudflare Turnstile CAPTCHA tokens on public registration and OTP endpoints when Turnstile secret is configured.

#### Scenario: Valid Turnstile token verification
- **WHEN** a registration request includes a verified Turnstile token
- **THEN** the system proceeds with account creation

#### Scenario: Missing or invalid Turnstile token
- **WHEN** Turnstile is configured on the host but the client provides an invalid token
- **THEN** the request is rejected with HTTP 403 Bot Verification Failed
