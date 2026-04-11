import { Notice, Plugin } from 'obsidian';
import { LifeVaultApiClient } from './api-client';
import { SyncEngine } from './sync-engine';
import { LifeVaultSyncSettingTab } from './settings';
import type { LifeVaultSyncSettings, SyncManifest } from './types';
import { DEFAULT_SETTINGS } from './types';

export default class LifeVaultSyncPlugin extends Plugin {
  settings: LifeVaultSyncSettings = DEFAULT_SETTINGS;
  api: LifeVaultApiClient = null!;
  private syncEngine: SyncEngine = null!;
  private syncManifest: SyncManifest = { files: {} };
  private statusBarEl: HTMLElement | null = null;
  private autoSyncIntervalId: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadManifest();

    // Initialize API client with auto re-login on token expiry
    this.api = new LifeVaultApiClient(
      this.settings.apiUrl,
      this.settings.accessToken,
      () => this.handleTokenExpired(),
    );

    // Initialize sync engine
    this.syncEngine = new SyncEngine(
      this.app.vault,
      this.api,
      this.settings,
      this.syncManifest,
    );

    // Settings tab
    this.addSettingTab(new LifeVaultSyncSettingTab(this.app, this));

    // Ribbon icon — cloud upload
    this.addRibbonIcon('cloud', 'LifeVault sync', async () => {
      if (!this.settings.accessToken) {
        new Notice('Please log in to LifeVault first (Settings > LifeVault Sync)');
        return;
      }
      if (!this.settings.vaultId) {
        new Notice('Please select a target vault (Settings > LifeVault Sync)');
        return;
      }
      await this.runSync();
    });

    // Command: Sync Now
    this.addCommand({
      id: 'sync-now',
      name: 'Sync now — push to LifeVault',
      callback: async () => {
        await this.runSync();
      },
    });

    // Command: Open settings
    this.addCommand({
      id: 'lifevault-open-settings',
      name: 'Open settings',
      callback: () => {
        const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
        setting.open();
        setting.openTabById('lifevault-sync');
      },
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    // Auto-sync
    this.setupAutoSync();

    console.debug('[LifeVault Sync] Plugin loaded');
  }

  onunload(): void {
    this.clearAutoSync();
    console.debug('[LifeVault Sync] Plugin unloaded');
  }

  // ── Settings persistence ──────────────────────────────────

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? data ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      syncManifest: this.syncManifest,
    });
  }

  /** Clear the sync manifest (e.g. when the target vault changes) */
  async clearSyncManifest(): Promise<void> {
    // Clear in-place so the SyncEngine's reference stays valid
    for (const key of Object.keys(this.syncManifest.files)) {
      delete this.syncManifest.files[key];
    }
    await this.saveManifest();
  }

  private async loadManifest(): Promise<void> {
    const data = await this.loadData();
    this.syncManifest = data?.syncManifest ?? { files: {} };
  }

  private async saveManifest(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      syncManifest: this.syncManifest,
    });
  }

  // ── Sync ──────────────────────────────────────────────────

  async runSync(): Promise<void> {
    if (!this.settings.accessToken || !this.settings.vaultId) {
      new Notice('LifeVault Sync: Please configure your account and vault first');
      return;
    }

    if (this.syncEngine.isBusy()) {
      new Notice('Sync already in progress...');
      return;
    }

    new Notice('LifeVault Sync: Starting...');
    this.updateStatusBar('Syncing...');

    try {
      const result = await this.syncEngine.pushSync((progress) => {
        if (progress.phase === 'uploading' && progress.currentFile) {
          this.updateStatusBar(`Syncing ${progress.completed}/${progress.total}`);
        }
      });

      // Persist updated manifest
      this.syncManifest = this.syncEngine.getManifest();
      await this.saveManifest();

      const msg = `LifeVault Sync complete: ${result.uploaded} uploaded, ${result.skipped} unchanged` +
        (result.errors > 0 ? `, ${result.errors} errors` : '');
      new Notice(msg);
      this.updateStatusBar();
    } catch (err) {
      console.error('[LifeVault Sync] Sync failed:', err);
      new Notice('LifeVault Sync failed — check console for details');
      this.updateStatusBar('Sync failed');
    }
  }

  // ── Auto-sync ─────────────────────────────────────────────

  setupAutoSync(): void {
    this.clearAutoSync();

    if (this.settings.autoSyncMinutes > 0) {
      const intervalMs = this.settings.autoSyncMinutes * 60 * 1000;
      this.autoSyncIntervalId = this.registerInterval(
        window.setInterval(() => {
          void this.runSync();
        }, intervalMs),
      ) as unknown as number;
    }
  }

  private clearAutoSync(): void {
    if (this.autoSyncIntervalId !== null) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
    }
  }

  // ── Status bar ────────────────────────────────────────────

  private updateStatusBar(text?: string): void {
    if (!this.statusBarEl) return;

    if (text) {
      this.statusBarEl.setText(`LV: ${text}`);
      return;
    }

    if (!this.settings.accessToken) {
      this.statusBarEl.setText('LV: Not connected');
      return;
    }

    if (this.settings.lastSyncAt) {
      const ago = this.timeAgo(new Date(this.settings.lastSyncAt));
      this.statusBarEl.setText(`LV: Synced ${ago}`);
    } else {
      this.statusBarEl.setText('LV: Ready');
    }
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ── Token refresh ─────────────────────────────────────────

  private async handleTokenExpired(): Promise<string> {
    // Token expired — we can't auto-refresh without stored password
    // Clear the token and notify the user to re-login
    this.settings.accessToken = '';
    this.settings.tokenExpiresAt = '';
    this.api.setToken('');
    await this.saveSettings();
    this.updateStatusBar('Session expired');
    new Notice('LifeVault session expired — please log in again in Settings');
    return '';
  }
}
