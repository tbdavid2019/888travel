# agent-integration-hub Specification

## Purpose
Provides user-facing and machine-readable integration surfaces, including in-app API key generation, tailored system prompts, llms.txt manifests, and exportable agent skills.

## Requirements

### Requirement: Personal Agent API Key Management
The system SHALL provide an in-app interface within Settings allowing authenticated users to generate, view, copy, and revoke a dedicated personal Agent API key.

#### Scenario: Generate initial agent API key
- **WHEN** user clicks "產生 Agent API Key" in Settings
- **THEN** the system SHALL create a cryptographically random key prefixed with `rr_agent_`, persist it in KV, and display it to the user

#### Scenario: Revoke or regenerate agent API key
- **WHEN** user clicks "重新產生 / 撤銷金鑰" in Settings
- **THEN** the system SHALL immediately invalidate the previous key and persist the new key in KV

### Requirement: Tailored Agent Prompt Generation
The system SHALL generate a copyable system prompt pre-filled with the user's live instance URL and active Agent API key.

#### Scenario: Copy agent system prompt
- **WHEN** user clicks "複製 Agent 提示詞 (System Prompt)"
- **THEN** the system SHALL copy a prompt containing the instance endpoint, API authentication header, data schemas, and planning instructions to clipboard

### Requirement: Standard LLMs Manifest Discovery
The system SHALL serve `/llms.txt` and `/llms-full.txt` at the root domain describing instance capabilities, schemas, and endpoints for AI web crawlers and LLM clients.

#### Scenario: Fetch llms.txt
- **WHEN** an HTTP client requests `GET /llms.txt`
- **THEN** the system SHALL respond with HTTP 200 and a markdown document following the llms.txt specification

### Requirement: Exportable Agent Skill
The system SHALL serve an exportable `SKILL.md` compliant with modern agent skill standards, downloadable or copyable directly from the Settings UI.

#### Scenario: Fetch skill manifest
- **WHEN** a client requests `GET /skill.md` or clicks "下載 SKILL.md" in Settings
- **THEN** the system SHALL return a standard YAML-frontmatter `SKILL.md` specifying tool definitions, parameters, and invocation guidance for AI coding agents
