import { Vault, TFile, Notice } from 'obsidian';
import { LifeVaultApiClient } from './api-client';
import type {
  LifeVaultSyncSettings,
  SyncManifest,
  SyncFileState,
  ObsidianProvenance,
} from './types';

/** MIME types for common Obsidian file extensions */
const MIME_MAP: Record<string, string> = {
  md: 'text/markdown',
  canvas: 'application/json',
  base: 'application/json',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wav: 'audio/wav',
  txt: 'text/plain',
  css: 'text/css',
  csv: 'text/csv',
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** Compute SHA-256 hex hash of an ArrayBuffer */
async function hashArrayBuffer(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return hex.join('');
}

export interface SyncProgress {
  phase: 'scanning' | 'comparing' | 'uploading' | 'done' | 'error';
  total: number;
  completed: number;
  currentFile: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export class SyncEngine {
  private vault: Vault;
  private api: LifeVaultApiClient;
  private settings: LifeVaultSyncSettings;
  private manifest: SyncManifest;
  private isSyncing = false;
  /** Cached remote items keyed by name (lowercase) for dedup */
  private remoteItemsByName: Map<string, { itemId: string; updatedAt: string }> | null = null;

  constructor(
    vault: Vault,
    api: LifeVaultApiClient,
    settings: LifeVaultSyncSettings,
    manifest: SyncManifest,
  ) {
    this.vault = vault;
    this.api = api;
    this.settings = settings;
    this.manifest = manifest;
  }

  getManifest(): SyncManifest {
    return this.manifest;
  }

  isBusy(): boolean {
    return this.isSyncing;
  }

  /** Run a full push sync (Obsidian -> LifeVault) */
  async pushSync(onProgress?: SyncProgressCallback): Promise<{ uploaded: number; skipped: number; errors: number }> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const report = (phase: SyncProgress['phase'], total: number, completed: number, currentFile: string) => {
        onProgress?.({ phase, total, completed, currentFile });
      };

      report('scanning', 0, 0, '');
      const localFiles = this.getLocalFiles();
      const totalFiles = localFiles.length;
      const manifestEntryCount = Object.keys(this.manifest.files).length;

      console.log(`[LifeVault Sync] Found ${totalFiles} local files, manifest has ${manifestEntryCount} entries`);

      report('comparing', totalFiles, 0, '');

      // Pre-fetch remote items to prevent duplicates
      await this.loadRemoteIndex();
      console.log(`[LifeVault Sync] Remote index: ${this.remoteItemsByName?.size ?? 0} items`);

      for (let i = 0; i < localFiles.length; i++) {
        const file = localFiles[i];
        const relativePath = file.path;

        report('uploading', totalFiles, i, relativePath);

        try {
          // Skip zero-byte files
          if (file.stat.size === 0) {
            console.log(`[LifeVault Sync] SKIP (zero-byte): ${relativePath}`);
            skipped++;
            continue;
          }

          // Hash the file content (all files read as binary)
          const data = await this.vault.readBinary(file);
          const currentHash = await hashArrayBuffer(data);

          let existing = this.manifest.files[relativePath];

          // If no manifest entry, try to recover from remote index by filename
          if (!existing?.remoteId && this.remoteItemsByName) {
            const match = this.remoteItemsByName.get(file.name.toLowerCase());
            if (match) {
              existing = {
                relativePath,
                contentHash: '',
                remoteId: match.itemId,
                remoteType: 'item',
                lastSyncedAt: '',
                remoteMtime: match.updatedAt,
              };
              this.manifest.files[relativePath] = existing;
            }
          }

          // Skip if hash unchanged since last sync AND previous upload succeeded
          if (existing && existing.contentHash === currentHash && existing.remoteId) {
            console.log(`[LifeVault Sync] SKIP (unchanged): ${relativePath} → ${existing.remoteId}`);
            skipped++;
            continue;
          }

          // Upload the file
          const mimeType = getMimeType(file.extension);
          const init = await this.api.initUpload(
            this.settings.vaultId,
            file.name,
            data.byteLength,
            mimeType,
          );

          const item = await this.api.uploadFile(init.uploadId, data, mimeType);

          // Update manifest
          this.manifest.files[relativePath] = {
            relativePath,
            contentHash: currentHash,
            remoteId: item.itemId,
            remoteType: 'item',
            lastSyncedAt: new Date().toISOString(),
            remoteMtime: item.updatedAt,
          };

          // Update remote index
          if (this.remoteItemsByName) {
            this.remoteItemsByName.set(file.name.toLowerCase(), {
              itemId: item.itemId,
              updatedAt: item.updatedAt,
            });
          }

          console.log(`[LifeVault Sync] UPLOADED: ${relativePath} → ${item.itemId}`);
          uploaded++;
        } catch (err) {
          console.error(`[LifeVault Sync] Failed to sync ${relativePath}:`, err);
          errors++;
        }
      }

      // Handle deletions — files in manifest but no longer local
      const localPaths = new Set(localFiles.map((f) => f.path));
      for (const [path] of Object.entries(this.manifest.files)) {
        if (!localPaths.has(path)) {
          delete this.manifest.files[path];
        }
      }

      this.settings.lastSyncAt = new Date().toISOString();
      report('done', totalFiles, totalFiles, '');
    } finally {
      this.isSyncing = false;
      this.remoteItemsByName = null;
    }

    return { uploaded, skipped, errors };
  }

  /** Fetch existing remote items to prevent creating duplicates */
  private async loadRemoteIndex(): Promise<void> {
    try {
      const items = await this.api.listItems(this.settings.vaultId);
      this.remoteItemsByName = new Map();
      for (const item of items) {
        const key = (item.name ?? '').toLowerCase();
        const existing = this.remoteItemsByName.get(key);
        if (!existing || item.updatedAt > existing.updatedAt) {
          this.remoteItemsByName.set(key, { itemId: item.itemId, updatedAt: item.updatedAt });
        }
      }
    } catch (err) {
      console.warn('[LifeVault Sync] Could not load remote items index:', err);
      this.remoteItemsByName = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private getVaultName(): string {
    const adapter = this.vault.adapter;
    if ('getBasePath' in adapter && typeof adapter.getBasePath === 'function') {
      const basePath = (adapter as { getBasePath(): string }).getBasePath();
      return basePath.split(/[\\/]/).pop() ?? 'Obsidian Vault';
    }
    return 'Obsidian Vault';
  }

  private getLocalFiles(): TFile[] {
    const allFiles = this.vault.getFiles();
    return allFiles.filter((file) => this.shouldSync(file.path));
  }

  private shouldSync(path: string): boolean {
    if (path.startsWith('.obsidian/plugins/lifevault-sync/')) return false;
    if (!this.settings.syncConfigFolder && path.startsWith('.obsidian/')) return false;
    if (path.startsWith('.trash/')) return false;
    if (path.endsWith('.base')) return false;

    for (const pattern of this.settings.excludePatterns) {
      if (this.matchGlob(path, pattern)) return false;
    }

    return true;
  }

  private matchGlob(path: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    return new RegExp(`^${regex}$`).test(path);
  }
}
