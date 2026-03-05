import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type LifeVaultSyncPlugin from './main';
import type { LifeVaultVault } from './types';

export class LifeVaultSyncSettingTab extends PluginSettingTab {
  plugin: LifeVaultSyncPlugin;
  private vaults: LifeVaultVault[] = [];

  constructor(app: App, plugin: LifeVaultSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'LifeVault Sync' });

    // ── Connection Status ───────────────────────────────────
    const isConnected = !!this.plugin.settings.accessToken;
    const statusEl = containerEl.createDiv({
      cls: `lifevault-connection-status ${isConnected ? 'connected' : 'disconnected'}`,
    });
    statusEl.setText(
      isConnected
        ? `Connected as ${this.plugin.settings.email}`
        : 'Not connected',
    );

    // ── API URL ─────────────────────────────────────────────
    new Setting(containerEl)
      .setName('API URL')
      .setDesc('LifeVault API endpoint. Change only for development.')
      .addText((text) =>
        text
          .setPlaceholder('https://lifevault-v2-api.vercel.app/api')
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value;
            this.plugin.api.setApiUrl(value);
            await this.plugin.saveSettings();
          }),
      );

    // ── Login / Logout ──────────────────────────────────────
    if (isConnected) {
      new Setting(containerEl)
        .setName('Account')
        .setDesc(`Logged in as ${this.plugin.settings.email}`)
        .addButton((btn) =>
          btn.setButtonText('Log out').onClick(async () => {
            this.plugin.settings.accessToken = '';
            this.plugin.settings.tokenExpiresAt = '';
            this.plugin.settings.email = '';
            this.plugin.settings.vaultId = '';
            this.plugin.settings.vaultName = '';
            this.plugin.api.setToken('');
            await this.plugin.saveSettings();
            new Notice('Logged out of LifeVault');
            this.display();
          }),
        );

      // ── Vault Selection ─────────────────────────────────────
      this.renderVaultPicker(containerEl);
    } else {
      this.renderLoginForm(containerEl);
    }

    // ── Sync Settings (only when connected + vault selected) ──
    if (isConnected && this.plugin.settings.vaultId) {
      containerEl.createEl('h3', { text: 'Sync Settings' });

      new Setting(containerEl)
        .setName('Auto-sync interval')
        .setDesc('Minutes between automatic syncs. Set to 0 to disable.')
        .addSlider((slider) =>
          slider
            .setLimits(0, 120, 5)
            .setValue(this.plugin.settings.autoSyncMinutes)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.autoSyncMinutes = value;
              await this.plugin.saveSettings();
              this.plugin.setupAutoSync();
            }),
        );

      new Setting(containerEl)
        .setName('Sync .obsidian/ folder')
        .setDesc('Include Obsidian config (themes, snippets, hotkeys). Excludes plugin binaries.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.syncConfigFolder)
            .onChange(async (value) => {
              this.plugin.settings.syncConfigFolder = value;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName('Exclude patterns')
        .setDesc('Comma-separated glob patterns to exclude (e.g., "drafts/**, *.tmp")')
        .addText((text) =>
          text
            .setPlaceholder('drafts/**, *.tmp')
            .setValue(this.plugin.settings.excludePatterns.join(', '))
            .onChange(async (value) => {
              this.plugin.settings.excludePatterns = value
                .split(',')
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
              await this.plugin.saveSettings();
            }),
        );

      // ── Last Sync Info ──────────────────────────────────────
      if (this.plugin.settings.lastSyncAt) {
        const lastSync = new Date(this.plugin.settings.lastSyncAt);
        new Setting(containerEl)
          .setName('Last sync')
          .setDesc(lastSync.toLocaleString());
      }

      // ── Manual Sync Button ──────────────────────────────────
      new Setting(containerEl)
        .setName('Sync now')
        .setDesc('Push local changes to LifeVault')
        .addButton((btn) =>
          btn
            .setButtonText('Sync Now')
            .setCta()
            .onClick(async () => {
              await this.plugin.runSync();
            }),
        );
    }
  }

  private renderLoginForm(containerEl: HTMLElement): void {
    const loginContainer = containerEl.createDiv({ cls: 'lifevault-login-container' });

    let emailValue = '';
    let passwordValue = '';

    new Setting(loginContainer)
      .setName('Email')
      .addText((text) =>
        text.setPlaceholder('your@email.com').onChange((value) => {
          emailValue = value;
        }),
      );

    const passwordSetting = new Setting(loginContainer)
      .setName('Password')
      .addText((text) => {
        text.setPlaceholder('Password').onChange((value) => {
          passwordValue = value;
        });
        // Make it a password field
        text.inputEl.type = 'password';
      });

    new Setting(loginContainer)
      .addButton((btn) =>
        btn
          .setButtonText('Log in to LifeVault')
          .setCta()
          .onClick(async () => {
            if (!emailValue || !passwordValue) {
              new Notice('Please enter your email and password');
              return;
            }

            try {
              btn.setDisabled(true);
              btn.setButtonText('Logging in...');

              const loginResponse = await this.plugin.api.login(emailValue, passwordValue);

              this.plugin.settings.accessToken = loginResponse.accessToken;
              this.plugin.settings.email = loginResponse.user.email;
              // JWT expires in 7 days
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 7);
              this.plugin.settings.tokenExpiresAt = expiresAt.toISOString();

              this.plugin.api.setToken(loginResponse.accessToken);
              await this.plugin.saveSettings();

              new Notice(`Logged in as ${loginResponse.user.displayName}`);
              this.display();
            } catch (err) {
              console.error('[LifeVault Sync] Login failed:', err);
              new Notice('Login failed — check your email and password');
              btn.setDisabled(false);
              btn.setButtonText('Log in to LifeVault');
            }
          }),
      );

    loginContainer.createEl('p', {
      text: "Don't have an account? Sign up at lifevaultsecure.com",
      cls: 'setting-item-description',
    });
  }

  private async renderVaultPicker(containerEl: HTMLElement): Promise<void> {
    const pickerContainer = containerEl.createDiv({ cls: 'lifevault-vault-picker' });

    // Load vaults if not cached
    if (this.vaults.length === 0) {
      try {
        this.vaults = await this.plugin.api.listVaults();
      } catch (err) {
        console.error('[LifeVault Sync] Failed to load vaults:', err);
        new Notice('Failed to load vaults — check your connection');
        return;
      }
    }

    const vaultOptions: Record<string, string> = { '': 'Select a vault...' };
    for (const v of this.vaults) {
      if (v.vaultType === 'standard') {
        vaultOptions[v.id] = `${v.name} (${v.itemCount} items)`;
      }
    }

    new Setting(pickerContainer)
      .setName('Target vault')
      .setDesc('Select which LifeVault to sync with')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(vaultOptions)
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            this.plugin.settings.vaultId = value;
            const selected = this.vaults.find((v) => v.id === value);
            this.plugin.settings.vaultName = selected?.name ?? '';
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    // Create new vault option
    new Setting(pickerContainer)
      .setName('Or create a new vault')
      .addButton((btn) =>
        btn.setButtonText('Create "Obsidian Backup"').onClick(async () => {
          try {
            const newVault = await this.plugin.api.createVault(
              'Obsidian Backup',
              'Synced from Obsidian via LifeVault Sync plugin',
            );
            this.plugin.settings.vaultId = newVault.id;
            this.plugin.settings.vaultName = newVault.name;
            this.vaults.push(newVault);
            await this.plugin.saveSettings();
            new Notice(`Created vault "${newVault.name}"`);
            this.display();
          } catch (err) {
            console.error('[LifeVault Sync] Failed to create vault:', err);
            new Notice('Failed to create vault');
          }
        }),
      );
  }
}
