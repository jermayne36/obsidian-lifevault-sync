import { requestUrl, RequestUrlResponse } from 'obsidian';
import type {
  LoginResponse,
  LifeVaultVault,
  LifeVaultNote,
  LifeVaultItem,
  InitUploadResponse,
  DownloadGrantResponse,
  ObsidianProvenance,
} from './types';

export class LifeVaultApiClient {
  private apiUrl: string;
  private accessToken: string;
  private onTokenExpired: () => Promise<string>;

  constructor(
    apiUrl: string,
    accessToken: string,
    onTokenExpired: () => Promise<string>,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.onTokenExpired = onTokenExpired;
  }

  setToken(token: string): void {
    this.accessToken = token;
  }

  setApiUrl(url: string): void {
    this.apiUrl = url.replace(/\/+$/, '');
  }

  // ── Auth ──────────────────────────────────────────────────

  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.request('POST', '/auth/login', {
      email,
      password,
    }, false);
    return res.json as LoginResponse;
  }

  async me(): Promise<LoginResponse['user']> {
    const res = await this.request('GET', '/auth/me');
    return res.json as LoginResponse['user'];
  }

  // ── Vaults ────────────────────────────────────────────────

  async listVaults(): Promise<LifeVaultVault[]> {
    const res = await this.request('GET', '/vaults');
    return res.json as LifeVaultVault[];
  }

  async createVault(name: string, description: string): Promise<LifeVaultVault> {
    const res = await this.request('POST', '/vaults', {
      name,
      description,
      vaultType: 'standard',
    });
    return res.json as LifeVaultVault;
  }

  // ── Notes (for .md files) ─────────────────────────────────

  async listNotes(vaultId: string): Promise<LifeVaultNote[]> {
    const res = await this.request('GET', `/vaults/${vaultId}/notes`);
    const data = res.json;
    return (Array.isArray(data) ? data : (data as { notes: LifeVaultNote[] }).notes ?? []) as LifeVaultNote[];
  }

  async getNote(vaultId: string, noteId: string): Promise<LifeVaultNote> {
    const res = await this.request('GET', `/vaults/${vaultId}/notes/${noteId}`);
    return res.json as LifeVaultNote;
  }

  async createNote(
    vaultId: string,
    title: string,
    content: string,
    provenance: ObsidianProvenance,
  ): Promise<LifeVaultNote> {
    const res = await this.request('POST', `/vaults/${vaultId}/notes`, {
      title,
      content,
      noteType: 'text',
      provenance,
    });
    return res.json as LifeVaultNote;
  }

  async updateNote(
    vaultId: string,
    noteId: string,
    title: string,
    content: string,
    provenance: ObsidianProvenance,
  ): Promise<LifeVaultNote> {
    const res = await this.request('PATCH', `/vaults/${vaultId}/notes/${noteId}`, {
      title,
      content,
      provenance,
    });
    return res.json as LifeVaultNote;
  }

  async deleteNote(vaultId: string, noteId: string): Promise<void> {
    await this.request('DELETE', `/vaults/${vaultId}/notes/${noteId}`);
  }

  // ── Items (for binary files) ──────────────────────────────

  async listItems(vaultId: string): Promise<LifeVaultItem[]> {
    const res = await this.request('GET', `/items?vaultId=${vaultId}`);
    const data = res.json;
    return (Array.isArray(data) ? data : (data as { items: LifeVaultItem[] }).items ?? []) as LifeVaultItem[];
  }

  async initUpload(
    vaultId: string,
    fileName: string,
    fileSize: number,
    contentType: string,
  ): Promise<InitUploadResponse> {
    const res = await this.request('POST', '/items/upload/init', {
      vaultId,
      fileName,
      fileSize,
      contentType,
    });
    return res.json as InitUploadResponse;
  }

  async uploadFile(uploadId: string, data: ArrayBuffer, contentType: string): Promise<LifeVaultItem> {
    const res = await requestUrl({
      url: `${this.apiUrl}/items/upload/${uploadId}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': contentType,
      },
      body: data,
    });
    return res.json as LifeVaultItem;
  }

  async downloadGrant(vaultId: string, itemId: string): Promise<DownloadGrantResponse> {
    const res = await this.request('POST', `/vaults/${vaultId}/items/${itemId}/download-grant`);
    return res.json as DownloadGrantResponse;
  }

  async downloadFile(downloadUrl: string): Promise<ArrayBuffer> {
    const res = await requestUrl({
      url: downloadUrl,
      method: 'GET',
    });
    return res.arrayBuffer;
  }

  // ── Internal ──────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    requireAuth = true,
  ): Promise<RequestUrlResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requireAuth) {
      if (!this.accessToken) {
        throw new Error('Not authenticated — please log in to LifeVault.');
      }
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      return await requestUrl({
        url: `${this.apiUrl}${path}`,
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: unknown) {
      // requestUrl throws on non-2xx — check for 401 to trigger re-auth
      const status = (err as { status?: number }).status;
      if (status === 401 && requireAuth) {
        const newToken = await this.onTokenExpired();
        if (newToken) {
          this.accessToken = newToken;
          headers['Authorization'] = `Bearer ${newToken}`;
          return await requestUrl({
            url: `${this.apiUrl}${path}`,
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        }
      }
      throw err;
    }
  }
}
