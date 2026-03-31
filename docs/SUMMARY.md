# Obsidian LifeVault Sync — Current State Summary

> Last verified: 2026-03-30. Read this first.

## Overview

Obsidian community plugin that syncs an Obsidian vault with LifeVault Secure. Push-sync from Obsidian to LifeVault's encrypted storage. Tier-limited (sync limits based on subscription plan).

## Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Platform | Obsidian Plugin API | Community plugin |
| Language | TypeScript | Compiled via esbuild |
| Build | esbuild | `esbuild.config.mjs` |
| Target | Obsidian desktop + mobile | — |

### Source Structure

```
src/
  main.ts          → Plugin entry point (onload/onunload)
  settings.ts      → Plugin settings tab
  api-client.ts    → LifeVault API client
  sync-engine.ts   → Core sync logic
  types.ts         → TypeScript types
```

### Output

- `main.js` — compiled plugin bundle
- `manifest.json` — Obsidian plugin manifest
- `styles.css` — Plugin styles

## Integration

- Connects to LifeVault Secure API for push sync
- Tier limits based on LifeVault subscription (Free/Premium/Family)
- Uses LifeVault API credentials configured in plugin settings

## Known Constraints & Gotchas

1. **Push-only sync** — current implementation syncs from Obsidian to LifeVault, not bidirectional.
2. **Community plugin submission** — README has comprehensive docs for Obsidian plugin review.
3. **No npm lockfile** — uses `package-lock.json` (npm), not pnpm.
4. **Version management**: `version-bump.mjs` updates `manifest.json` and `versions.json` together.

## Deprecated Docs

No docs folder existed prior to this file. README.md contains community plugin submission documentation.
