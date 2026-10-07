# agent-api Specification

## Purpose
Provides a programmatic RESTful API with dedicated token authentication enabling external AI agents to perform structured CRUD operations on travel trips and itinerary segments.

## Requirements

### Requirement: Agent Token Authentication
The system SHALL authenticate external agent requests using an `Authorization: Bearer <token>` header containing a valid agent API key scoped strictly to `/api/v1/*` routes.

#### Scenario: Valid agent token succeeds
- **WHEN** an agent sends an HTTP request to an `/api/v1/*` endpoint with a valid `Authorization: Bearer rr_agent_...` header
- **THEN** the system SHALL authorize the request and return HTTP status 200/201

#### Scenario: Missing or invalid agent token rejected
- **WHEN** an agent sends an HTTP request without a token or with an invalid token
- **THEN** the system SHALL reject the request with HTTP status 401 and a JSON error message

### Requirement: Trip Listing and Inspection
The system SHALL provide endpoints for external agents to list trips and retrieve full trip details including segments and metadata.

#### Scenario: List all trips
- **WHEN** an authenticated agent sends `GET /api/v1/trips`
- **THEN** the system SHALL return a JSON list of trips with their id, destination, dates, and segment count

#### Scenario: Fetch single trip by ID
- **WHEN** an authenticated agent sends `GET /api/v1/trips/:id` with an existing trip ID
- **THEN** the system SHALL return the complete trip object with all segments, fallback plans, and places information

### Requirement: Trip Upsert and Modification
The system SHALL allow external agents to create new trips and update existing trip headers, dates, and notes.

#### Scenario: Create a new trip
- **WHEN** an authenticated agent sends `POST /api/v1/trips` with `from`, `to`, `start`, and `end`
- **THEN** the system SHALL create the trip in KV, assign a unique ID if omitted, and return the saved trip

#### Scenario: Update an existing trip
- **WHEN** an authenticated agent sends `PUT /api/v1/trips/:id` with updated dates or notes
- **THEN** the system SHALL persist the changes and update the trip timestamp

### Requirement: Trip Deletion
The system SHALL allow external agents to delete a trip and its associated itinerary data.

#### Scenario: Delete trip by ID
- **WHEN** an authenticated agent sends `DELETE /api/v1/trips/:id`
- **THEN** the system SHALL remove the trip from KV and return `{ "ok": true }`

### Requirement: Segment CRUD with Fallback Plans
The system SHALL allow external agents to add (single or batch), modify, and delete itinerary segments of all 7 categories (flight, hotel, restaurant, car, ride, rail, other) along with optional fallback plans.

#### Scenario: Add segment with fallback plan
- **WHEN** an authenticated agent sends `POST /api/v1/trips/:id/segments` with a valid category, name, start, and a `fallback` object
- **THEN** the system SHALL append the segment to the trip with `source: "manual"` and return the created segment

#### Scenario: Add batch segments in single request
- **WHEN** an authenticated agent sends `POST /api/v1/trips/:id/segments` with a JSON array of segment objects
- **THEN** the system SHALL append all valid segments to the trip in order with `source: "manual"` and return the array of created segments

#### Scenario: Update existing segment
- **WHEN** an authenticated agent sends `PUT /api/v1/trips/:id/segments/:sid` with updated time or notes
- **THEN** the system SHALL update the segment while preserving existing confirmation codes and metadata

#### Scenario: Delete segment with tombstoning
- **WHEN** an authenticated agent sends `DELETE /api/v1/trips/:id/segments/:sid`
- **THEN** the system SHALL remove the segment, tombstone its confirmation code in `store.deletedSegs`, and persist the updated trip

### Requirement: Data Integrity and Manual Protection
The system SHALL guarantee that segments created or edited via the Agent API are assigned `source: "manual"`, ensuring background sync operations never overwrite or delete them.

#### Scenario: Ingestion protection invariant
- **WHEN** a background sync runs against trips modified by an agent
- **THEN** the system SHALL preserve all agent-created segments without alteration
