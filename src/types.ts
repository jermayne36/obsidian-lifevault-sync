/** Plugin settings persisted in data.json */
export interface LifeVaultSyncSettings {
  /** LifeVault API base URL */
  apiUrl: string;
  /** User email for login */
  email: string;
  /** Stored JWT (not the password — we login and store the token) */
  accessToken: string;
  /** Token expiry ISO string */
  tokenExpiresAt: string;
  /** Selected vault ID to sync with */
  vaultId: string;
  /** Selected vault name (display only) */
  vaultName: string;
  /** Auto-sync interval in minutes (0 = disabled) */
  autoSyncMinutes: number;
  /** Exclude patterns (glob-style) */
  excludePatterns: string[];
  /** Whether to sync the .obsidian/ config folder */
  syncConfigFolder: boolean;
  /** Last successful sync ISO timestamp */
  lastSyncAt: string;
}

export const DEFAULT_SETTINGS: LifeVaultSyncSettings = {
  apiUrl: 'https://lifevault-v2-api.vercel.app/api',
  email: '',
  accessToken: '',
  tokenExpiresAt: '',
  vaultId: '',
  vaultName: '',
  autoSyncMinutes: 0,
  excludePatterns: [],
  syncConfigFolder: false,
  lastSyncAt: '',
};

/** Auth response from /auth/login */
export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    tier: string;
    isSystemAdmin: boolean;
  };
}

/** Vault from /vaults listing */
export interface LifeVaultVault {
  id: string;
  name: string;
  description: string;
  vaultType: string;
  encryptionMode: string;
  itemCount: number;
  memberCount: number;
}

/** VaultNote from API */
export interface LifeVaultNote {
  noteId: string;
  vaultId: string;
  title: string;
  noteType: string;
  isPinned: boolean;
  sizeBytes: number;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

/** VaultItem from API */
export interface LifeVaultItem {
  itemId: string;
  vaultId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploaderId: string;
  uploaderName: string;
  createdAt: string;
  updatedAt: string;
  provenance?: Record<string, unknown>;
}

/** Provenance metadata stored on remote items */
export interface ObsidianProvenance {
  source: 'obsidian-plugin';
  obsidianVault: string;
  relativePath: string;
  contentHash: string;
  syncedAt: string;
}

/** Local sync state for a single file */
export interface SyncFileState {
  relativePath: string;
  contentHash: string;
  remoteId: string;
  remoteType: 'note' | 'item';
  lastSyncedAt: string;
  remoteMtime: string;
}

/** Full sync manifest stored in plugin data */
export interface SyncManifest {
  files: Record<string, SyncFileState>;
}

/** Upload init response */
export interface InitUploadResponse {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
}

/** Download grant response */
export interface DownloadGrantResponse {
  downloadUrl: string;
  expiresAt: string;
}
