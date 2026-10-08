# Spec Delta: multi-tenant-auth

## Purpose

Provides multi-tenant account lifecycle management, tenant store isolation in Cloudflare KV, and dynamic administrator control over public user registration.

## ADDED Requirements

### Requirement: Dynamic Registration Toggle
The system SHALL support an administrative configuration setting `allow_registration` stored in `system:config` that dictates whether new users may register accounts.

#### Scenario: Registration is closed by default
- **WHEN** an unauthenticated visitor requests account registration while `allow_registration` is false
- **THEN** the system rejects the request with HTTP 403 and message indicating registration is currently closed

#### Scenario: Admin toggles registration status
- **WHEN** an authenticated administrator updates `allow_registration` via `POST /admin/config`
- **THEN** the system updates `system:config` and immediately applies the new registration policy globally

### Requirement: User Registration Gateway
The system SHALL provide a `POST /auth/register` endpoint supporting email and password or email OTP verification to create a new tenant account when registration is open.

#### Scenario: Successful registration when open
- **WHEN** a new user submits valid credentials and `allow_registration` is true
- **THEN** the system creates a new user record `user:by_email:<email>` with role `user` and returns an active session token

#### Scenario: Duplicate email rejection
- **WHEN** a registration request is submitted for an already registered email address
- **THEN** the system rejects the request with HTTP 409 Conflict without modifying existing records

### Requirement: Tenant-Scoped Store Isolation
The system SHALL isolate all trip records, itineraries, and settings by user identifier using key prefix `store:<uid>` in Cloudflare KV.

#### Scenario: Data retrieval is strictly tenant-scoped
- **WHEN** an authenticated user calls `GET /trips`
- **THEN** the system returns only the trip records associated with the caller's `uid` from `store:<uid>`

#### Scenario: Data persistence does not affect other tenants
- **WHEN** an authenticated user adds or updates a trip via `POST /trips`
- **THEN** the system updates only `store:<uid>` and leaves all other tenant stores unchanged

### Requirement: User-Scoped Session Tokens
The system SHALL generate cryptographically random session tokens stored under `session:<token>` mapping to tenant metadata with an expiration time.

#### Scenario: Valid session authentication
- **WHEN** an API request includes a valid session token via cookie `tk` or header `X-Auth`
- **THEN** the system resolves the session to `{ uid, email, role }` and authorizes tenant-level operations

#### Scenario: Expired or invalid session
- **WHEN** an API request presents an expired or revoked session token
- **THEN** the system returns HTTP 401 Unauthorized and prompts the client to authenticate

### Requirement: Single-User Legacy Migration
The system SHALL automatically migrate existing unpartitioned `store` and `auth` credentials to the initial `admin` tenant on first multi-tenant boot.

#### Scenario: First run migration of existing data
- **WHEN** the system detects existing `auth` and `store` keys without a tenant index
- **THEN** it assigns the existing data to `store:<admin_uid>` and sets `user:by_email:<admin_email>` as the system administrator
