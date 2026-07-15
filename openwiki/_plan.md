---
type: Migration Plan
title: OKF Front Matter Migration Plan
description: Temporary directory-level plan for adding OKF front matter to generated OpenWiki pages.
tags: [openwiki, okf, migration]
---

# OKF Front Matter Migration Plan

This migration changes only missing or invalid leading OKF YAML front matter on generated Markdown pages. Page bodies and `INSTRUCTIONS.md` are out of scope. Directory `index.md` files, if present, are also out of scope.

| Directory | Assigned subagent | Direct Markdown pages in scope |
| --- | --- | --- |
| `/openwiki` | root-wiki-migrator | `quickstart.md` |
| `/openwiki/agent` | agent-wiki-migrator | `workflow.md` |
| `/openwiki/architecture` | architecture-wiki-migrator | `overview.md` |
| `/openwiki/cli` | cli-wiki-migrator | `usage.md` |
| `/openwiki/integrations` | integrations-wiki-migrator | `connectors.md` |
| `/openwiki/operations` | operations-wiki-migrator | `credentials-and-updates.md` |

`/openwiki/INSTRUCTIONS.md` is user-authored control metadata and is intentionally excluded. No generated directory indexes were found.
