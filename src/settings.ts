import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type LifeVaultSyncPlugin from './main';
import type { LifeVaultVault } from './types';
import { getTierLimits, formatStorage } from './types';

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

    new Setting(containerEl).setName('LifeVault sync').setHeading();

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
          .setPlaceholder('https://api.lifevaultsecure.com/api')
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value;
            this.plugin.api.setApiUrl(value);
            await this.plugin.saveSettings();
          }),
      );

    // ── Login / Logout ──────────────────────────────────────
    if (isConnected) {
      const limits = getTierLimits(this.plugin.settings.tier);

      new Setting(containerEl)
        .setName('Account')
        .setDesc(`Logged in as ${this.plugin.settings.email}`)
        .addButton((btn) =>
          btn.setButtonText('Refresh account').onClick(async () => {
            try {
              btn.setDisabled(true);
              btn.setButtonText('Refreshing...');
              const meResponse = await this.plugin.api.me();
              this.plugin.settings.tier = (meResponse as { tier?: string }).tier ?? this.plugin.settings.tier;
              this.vaults = [];
              await this.plugin.saveSettings();
              new Notice('Account refreshed');
              this.display();
            } catch (err) {
              console.error('[LifeVault Sync] Refresh failed:', err);
              new Notice('Failed to refresh — check your connection');
              btn.setDisabled(false);
              btn.setButtonText('Refresh account');
            }
          }),
        )
        .addButton((btn) =>
          btn.setButtonText('Log out').onClick(async () => {
            this.plugin.settings.accessToken = '';
            this.plugin.settings.tokenExpiresAt = '';
            this.plugin.settings.email = '';
            this.plugin.settings.tier = 'free';
            this.plugin.settings.vaultId = '';
            this.plugin.settings.vaultName = '';
            this.plugin.api.setToken('');
            await this.plugin.saveSettings();
            new Notice('Logged out of LifeVault');
            this.display();
          }),
        );

      // ── Plan Info ───────────────────────────────────────────
      const planEl = containerEl.createDiv({ cls: 'lifevault-plan-info' });
      const vaultLimitText = limits.maxVaults === -1
        ? 'Unlimited vaults'
        : `Up to ${limits.maxVaults} vaults`;
      planEl.createEl('p', {
        text: `Plan: ${limits.displayName}  |  ${vaultLimitText}  |  ${formatStorage(limits.storageLimitMB)} storage`,
      });
      if (limits.maxVaults !== -1) {
        planEl.createEl('p', {
          text: 'Upgrade at lifevaultsecure.com/pricing for more vaults and storage.',
          cls: 'setting-item-description',
        });
      }

      // ── Vault Selection ─────────────────────────────────────
      const vaultPickerContainer = containerEl.createDiv({ cls: 'lifevault-vault-picker' });
      this.renderVaultPickerAsync(vaultPickerContainer);

      // ── Sync Settings (rendered below vault picker) ──────────
      this.renderSyncSettings(containerEl);
    } else {
      this.renderLoginForm(containerEl);
    }
  }

  private renderSyncSettings(containerEl: HTMLElement): void {
    if (!this.plugin.settings.vaultId) return;

    new Setting(containerEl).setName('Sync settings').setHeading();

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
      .setName(`Sync ${this.app.vault.configDir}/ folder`)
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

    if (this.plugin.settings.lastSyncAt) {
      const lastSync = new Date(this.plugin.settings.lastSyncAt);
      new Setting(containerEl)
        .setName('Last sync')
        .setDesc(lastSync.toLocaleString());
    }

    new Setting(containerEl)
      .setName('Sync now')
      .setDesc('Push local changes to LifeVault')
      .addButton((btn) =>
        btn
          .setButtonText('Sync now')
          .setCta()
          .onClick(async () => {
            await this.plugin.runSync();
          }),
      );
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

    new Setting(loginContainer)
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
              this.plugin.settings.tier = loginResponse.user.tier ?? 'free';
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

  private renderVaultPickerAsync(container: HTMLElement): void {
    // Show loading state synchronously
    const loadingEl = container.createEl('p', { text: 'Loading vaults...' });

    // Fetch vaults in the background, then populate
    this.loadAndRenderVaults(container, loadingEl).catch((err) => {
      console.error('[LifeVault Sync] Vault picker error:', err);
      loadingEl.setText('Error loading vaults — check the console.');
    });
  }

  private async loadAndRenderVaults(container: HTMLElement, loadingEl: HTMLElement): Promise<void> {
    if (this.vaults.length === 0) {
      try {
        this.vaults = await this.plugin.api.listVaults();
      } catch (err) {
        console.error('[LifeVault Sync] Failed to load vaults:', err);
        loadingEl.setText('Failed to load vaults — check your connection.');
        return;
      }
    }

    // Remove loading indicator
    loadingEl.remove();

    // Detect if selected vault was deleted remotely
    if (this.plugin.settings.vaultId) {
      const stillExists = this.vaults.some((v) => v.id === this.plugin.settings.vaultId);
      if (!stillExists) {
        const deletedName = this.plugin.settings.vaultName || 'your selected vault';
        this.plugin.settings.vaultId = '';
        this.plugin.settings.vaultName = '';
        await this.plugin.clearSyncManifest();
        await this.plugin.saveSettings();
        new Notice(`"${deletedName}" was deleted from LifeVault. Please select a new target vault.`);
      }
    }

    const vaultOptions: Record<string, string> = { '': 'Select a vault...' };
    for (const v of this.vaults) {
      if (v.vaultType === 'standard') {
        vaultOptions[v.id] = `${v.name} (${v.itemCount} items)`;
      }
    }

    new Setting(container)
      .setName('Target vault')
      .setDesc('Select which LifeVault to sync with')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(vaultOptions)
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            const previousVaultId = this.plugin.settings.vaultId;
            this.plugin.settings.vaultId = value;
            const selected = this.vaults.find((v) => v.id === value);
            this.plugin.settings.vaultName = selected?.name ?? '';
            if (value !== previousVaultId) {
              await this.plugin.clearSyncManifest();
            }
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const limits = getTierLimits(this.plugin.settings.tier);
    const currentVaultCount = this.vaults.length;
    const atVaultLimit = limits.maxVaults !== -1 && currentVaultCount >= limits.maxVaults;

    if (atVaultLimit) {
      new Setting(container)
        .setName('Vault limit reached')
        .setDesc(
          `Your ${limits.displayName} plan allows ${limits.maxVaults} vaults and you currently have ${currentVaultCount}. ` +
          'Select an existing vault above, or upgrade your plan at lifevaultsecure.com/pricing.',
        );
    } else {
      const remainingText = limits.maxVaults === -1
        ? ''
        : ` (${currentVaultCount}/${limits.maxVaults} used)`;
      let newVaultName = 'Obsidian Backup';

      new Setting(container)
        .setName('Or create a new vault')
        .setDesc(`Create a dedicated vault for your Obsidian backup${remainingText}`)
        .addText((text) =>
          text
            .setPlaceholder('Obsidian Backup')
            .setValue(newVaultName)
            .onChange((value) => {
              newVaultName = value.trim();
            }),
        )
        .addButton((btn) =>
          btn.setButtonText('Create').setCta().onClick(async () => {
            const name = newVaultName || 'Obsidian Backup';

            // Check for duplicate name
            const duplicate = this.vaults.find(
              (v) => v.name.toLowerCase() === name.toLowerCase() && v.vaultType === 'standard',
            );
            if (duplicate) {
              new Notice(`A vault named "${name}" already exists. Choose a different name or select it from the dropdown.`);
              return;
            }

            try {
              btn.setDisabled(true);
              btn.setButtonText('Creating...');
              const newVault = await this.plugin.api.createVault(
                name,
                'Synced from Obsidian via LifeVault Sync plugin',
              );
              this.plugin.settings.vaultId = newVault.id;
              this.plugin.settings.vaultName = newVault.name;
              this.vaults.push(newVault);
              await this.plugin.clearSyncManifest();
              await this.plugin.saveSettings();
              new Notice(`Created vault "${newVault.name}"`);
              this.display();
            } catch (err) {
              console.error('[LifeVault Sync] Failed to create vault:', err);
              new Notice('Failed to create vault');
              btn.setDisabled(false);
              btn.setButtonText('Create');
            }
          }),
        );
    }
  }
}
