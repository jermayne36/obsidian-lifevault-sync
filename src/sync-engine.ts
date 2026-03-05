import { Vault, TFile, TFolder, Notice } from 'obsidian';
import { LifeVaultApiClient } from './api-client';
import type {
  LifeVaultSyncSettings,
  SyncManifest,
  SyncFileState,
  ObsidianProvenance,
  LifeVaultNote,
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

/** Compute SHA-256 hex hash of a string */
async function hashString(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

/** Compute SHA-256 hex hash of an ArrayBuffer */
async function hashArrayBuffer(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return hex.join('');
}

/** Extract note title from a markdown file path */
function titleFromPath(relativePath: string): string {
  const basename = relativePath.split('/').pop() ?? relativePath;
  return basename.replace(/\.md$/, '');
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
      // 1. Scan local vault
      const report = (phase: SyncProgress['phase'], total: number, completed: number, currentFile: string) => {
        onProgress?.({ phase, total, completed, currentFile });
      };

      report('scanning', 0, 0, '');
      const localFiles = this.getLocalFiles();
      const totalFiles = localFiles.length;

      report('comparing', totalFiles, 0, '');

      // 2. Compare each file against manifest and push changes
      for (let i = 0; i < localFiles.length; i++) {
        const file = localFiles[i];
        const relativePath = file.path;

        report('uploading', totalFiles, i, relativePath);

        try {
          const isMarkdown = file.extension === 'md';
          const currentHash = isMarkdown
            ? await hashString(await this.vault.read(file))
            : await hashArrayBuffer(await this.vault.readBinary(file));

          const existing = this.manifest.files[relativePath];

          // Skip if hash unchanged since last sync
          if (existing && existing.contentHash === currentHash) {
            skipped++;
            continue;
          }

          const provenance: ObsidianProvenance = {
            source: 'obsidian-plugin',
            obsidianVault: this.getVaultName(),
            relativePath,
            contentHash: currentHash,
            syncedAt: new Date().toISOString(),
          };

          if (isMarkdown) {
            await this.pushMarkdownFile(file, relativePath, existing, provenance);
          } else {
            await this.pushBinaryFile(file, relativePath, existing, provenance);
          }

          // Update manifest
          this.manifest.files[relativePath] = {
            relativePath,
            contentHash: currentHash,
            remoteId: this.manifest.files[relativePath]?.remoteId ?? '',
            remoteType: isMarkdown ? 'note' : 'item',
            lastSyncedAt: provenance.syncedAt,
            remoteMtime: provenance.syncedAt,
          };

          uploaded++;
        } catch (err) {
          console.error(`[LifeVault Sync] Failed to sync ${relativePath}:`, err);
          errors++;
        }
      }

      // 3. Handle deletions — files in manifest but no longer local
      const localPaths = new Set(localFiles.map((f) => f.path));
      for (const [path, state] of Object.entries(this.manifest.files)) {
        if (!localPaths.has(path)) {
          try {
            if (state.remoteType === 'note') {
              await this.api.deleteNote(this.settings.vaultId, state.remoteId);
            }
            // VaultItems use soft-delete — skip for now to be safe
            delete this.manifest.files[path];
          } catch (err) {
            console.error(`[LifeVault Sync] Failed to delete remote ${path}:`, err);
          }
        }
      }

      this.settings.lastSyncAt = new Date().toISOString();
      report('done', totalFiles, totalFiles, '');
    } finally {
      this.isSyncing = false;
    }

    return { uploaded, skipped, errors };
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
    // Always exclude plugin's own data
    if (path.startsWith('.obsidian/plugins/lifevault-sync/')) return false;

    // Exclude .obsidian/ unless opted in
    if (!this.settings.syncConfigFolder && path.startsWith('.obsidian/')) return false;

    // Exclude trash
    if (path.startsWith('.trash/')) return false;

    // Check user exclude patterns
    for (const pattern of this.settings.excludePatterns) {
      if (this.matchGlob(path, pattern)) return false;
    }

    return true;
  }

  private matchGlob(path: string, pattern: string): boolean {
    // Simple glob matching — supports * and **
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    return new RegExp(`^${regex}$`).test(path);
  }

  private async pushMarkdownFile(
    file: TFile,
    relativePath: string,
    existing: SyncFileState | undefined,
    provenance: ObsidianProvenance,
  ): Promise<void> {
    const content = await this.vault.read(file);
    const title = titleFromPath(relativePath);

    if (existing?.remoteId && existing.remoteType === 'note') {
      // Update existing note
      const updated = await this.api.updateNote(
        this.settings.vaultId,
        existing.remoteId,
        title,
        content,
        provenance,
      );
      this.manifest.files[relativePath] = {
        ...this.manifest.files[relativePath],
        remoteId: updated.noteId,
        remoteMtime: updated.updatedAt,
      };
    } else {
      // Create new note
      const created = await this.api.createNote(
        this.settings.vaultId,
        title,
        content,
        provenance,
      );
      this.manifest.files[relativePath] = {
        ...this.manifest.files[relativePath],
        remoteId: created.noteId,
        remoteType: 'note',
        remoteMtime: created.updatedAt,
      };
    }
  }

  private async pushBinaryFile(
    file: TFile,
    relativePath: string,
    existing: SyncFileState | undefined,
    provenance: ObsidianProvenance,
  ): Promise<void> {
    const data = await this.vault.readBinary(file);
    const mimeType = getMimeType(file.extension);

    // For binary files, we always upload a new version
    // (LifeVault items don't have an update endpoint — upload replaces)
    const init = await this.api.initUpload(
      this.settings.vaultId,
      file.name,
      data.byteLength,
      mimeType,
    );

    const item = await this.api.uploadFile(init.uploadId, data, mimeType);

    this.manifest.files[relativePath] = {
      ...this.manifest.files[relativePath],
      remoteId: item.itemId,
      remoteType: 'item',
      remoteMtime: item.updatedAt,
    };
  }
}
