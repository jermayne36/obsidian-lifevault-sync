# LifeVault Sync for Obsidian

Sync your Obsidian vault with [LifeVault](https://www.lifevaultsecure.com) — encrypted cloud backup for your notes and files.

## Features

- **End-to-end encrypted backup** — Your notes are encrypted before leaving your device
- **Push sync** — One-click or automatic sync from Obsidian to your LifeVault vault
- **Tier-aware limits** — Respects your LifeVault plan's storage and vault limits
- **Selective sync** — Exclude files and folders with glob patterns
- **Auto-sync** — Set an interval and your vault syncs in the background
- **Sync manifest tracking** — Only changed files are uploaded, saving bandwidth
- **Config folder option** — Optionally sync your `.obsidian/` settings folder

## Installation

### From Obsidian Community Plugins (recommended)

1. Open **Settings → Community Plugins → Browse**
2. Search for **"LifeVault Sync"**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/jermayne36/obsidian-lifevault-sync/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` into your vault at `.obsidian/plugins/lifevault-sync/`
3. Enable the plugin in **Settings → Community Plugins**

## Setup

1. Create a free LifeVault account at [lifevaultsecure.com](https://www.lifevaultsecure.com)
2. In Obsidian, go to **Settings → LifeVault Sync**
3. Enter your LifeVault email and log in
4. Select which LifeVault vault to sync to
5. Click the cloud icon in the ribbon or run the **"Sync now"** command

## Usage

### Manual Sync
- Click the **cloud icon** in the left ribbon, or
- Open the command palette (`Ctrl/Cmd + P`) and run **"LifeVault Sync: Sync now — push to LifeVault"**

### Auto Sync
- In plugin settings, set **Auto-sync interval** to your preferred minutes (e.g., 30)
- The plugin will sync in the background at that interval

### Exclude Files
- In plugin settings, add glob patterns to **Exclude patterns** (e.g., `*.tmp`, `drafts/**`)

### Status Bar
- The status bar shows your last sync time and current sync status

## Storage Limits

Your sync capacity depends on your LifeVault plan:

| Plan | Vaults | Storage |
|------|--------|---------|
| Free | 8 | 256 MB |
| Pro | 40 | 5 GB |
| Premium | Unlimited | 15 GB |
| Family | Unlimited | 30 GB |

## Security

All data is encrypted end-to-end before leaving your device. LifeVault uses zero-knowledge architecture — even LifeVault cannot read your notes. Your login token is stored locally in the plugin's `data.json` file and is never shared.

## Support

- **Website**: [lifevaultsecure.com](https://www.lifevaultsecure.com)
- **Issues**: [GitHub Issues](https://github.com/jermayne36/obsidian-lifevault-sync/issues)

## License

[MIT](LICENSE)
