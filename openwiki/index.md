---
okf_version: "0.1"
---

# Index

## Architecture
- [Architecture overview](/architecture/overview.md) — Runtime structure of the OpenWiki CLI and agent, including the two output modes, sandboxing, and the post-run OKF pass.

## CLI
- [CLI usage](/cli/usage.md) — Commands, modes, and options exposed by the openwiki binary, including connector auth, ingestion, and scheduling subcommands.

## Domain Concept
- [Open Knowledge Format (OKF)](/domain/okf-format.md) — The frontmatter and reserved-file contract that every OpenWiki-generated bundle (repository docs or personal wiki) must satisfy.

## Integration
- [Auth and OAuth](/integrations/auth-and-oauth.md) — How openwiki auth obtains, stores, and refreshes connector credentials, and how ngrok supports Slack's HTTPS OAuth requirement.
- [Connectors](/integrations/connectors.md) — Built-in OpenWiki connectors that ingest external sources into local raw data for personal-mode wiki synthesis.

## Operation
- [Credentials and updates](/operations/credentials-and-updates.md) — Local credential storage, onboarding profile, schedules, and update metadata that keep OpenWiki runs reproducible.

## Overview
- [OpenWiki quickstart](/quickstart.md) — Entry point for the OpenWiki CLI docs — what OpenWiki does, its two modes, and where to go next.

## Workflow
- [Agent workflow](/agent/workflow.md) — How an OpenWiki init/update/chat run is prompted, executed, normalized into OKF, and persisted.
