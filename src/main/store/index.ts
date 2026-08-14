import { randomBytes } from 'node:crypto';
import type {
  ConfigSnapshot,
  Credential,
  Folder,
  Host,
  Settings,
} from '@shared/config.js';
import type { SshAuth, SshTarget } from '@shared/types.js';
import type { SecretsStore } from '../secrets/store.js';
import { createCredentialsStore, removeCredential, upsertCredential } from './credentials.js';
import {
  createHostsStore,
  detachCredential,
  removeFolder,
  removeHost,
  upsertFolder,
  upsertHost,
} from './hosts.js';
import { applySettings, createSettingsStore } from './settings.js';

export function newConfigId(prefix: 'hst' | 'crd' | 'fld'): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export interface CredentialSecrets {
  /** Omitted means "unchanged"; an empty string clears the stored secret. */
  password?: string;
  passphrase?: string;
}

/**
 * Owns the three config files and the secret vault, and keeps them consistent —
 * deleting a credential also clears its secrets and detaches the hosts using it.
 */
export class ConfigService {
  private readonly hosts;
  private readonly credentials;
  private readonly settings;

  constructor(
    private readonly secrets: SecretsStore,
    dir?: string,
  ) {
    // Built here rather than as field initialisers: those run before parameter
    // properties are assigned, so `dir` would still be undefined.
    this.hosts = createHostsStore(dir);
    this.credentials = createCredentialsStore(dir);
    this.settings = createSettingsStore(dir);
  }

  async snapshot(): Promise<ConfigSnapshot> {
    return {
      hosts: await this.hosts.read(),
      credentials: await this.credentials.read(),
      settings: await this.settings.read(),
      secrets: this.secrets.status(),
    };
  }

  async saveHost(host: Host, secrets?: CredentialSecrets): Promise<ConfigSnapshot> {
    await this.hosts.update((file) => upsertHost(file, host));
    // An inline credential keys its secret by host ID (§4.1).
    if (host.inlineCredential) await this.writeSecrets(host.id, secrets);
    return this.snapshot();
  }

  async deleteHost(hostId: string): Promise<ConfigSnapshot> {
    await this.hosts.update((file) => removeHost(file, hostId));
    await this.secrets.forget(hostId);
    return this.snapshot();
  }

  async saveFolder(folder: Folder): Promise<ConfigSnapshot> {
    await this.hosts.update((file) => upsertFolder(file, folder));
    return this.snapshot();
  }

  async deleteFolder(folderId: string): Promise<ConfigSnapshot> {
    await this.hosts.update((file) => removeFolder(file, folderId));
    return this.snapshot();
  }

  async saveCredential(
    credential: Credential,
    secrets?: CredentialSecrets,
  ): Promise<ConfigSnapshot> {
    await this.credentials.update((file) => upsertCredential(file, credential));
    await this.writeSecrets(credential.id, secrets);
    return this.snapshot();
  }

  async deleteCredential(credentialId: string): Promise<ConfigSnapshot> {
    await this.credentials.update((file) => removeCredential(file, credentialId));
    await this.hosts.update((file) => detachCredential(file, credentialId));
    await this.secrets.forget(credentialId);
    return this.snapshot();
  }

  async saveSettings(patch: Partial<Settings>): Promise<ConfigSnapshot> {
    await this.settings.update((current) => applySettings(current, patch));
    return this.snapshot();
  }

  /**
   * Builds what the SSH layer needs from a saved host. A secret that cannot be read —
   * no keychain, or never stored — degrades to an inline prompt rather than failing.
   */
  async resolveTarget(hostId: string): Promise<SshTarget | null> {
    const host = (await this.hosts.read()).hosts.find((entry) => entry.id === hostId);
    if (!host || host.protocol !== 'ssh' || !host.address) return null;

    const auth = await this.resolveAuth(host);
    return {
      name: host.name,
      address: host.address,
      port: host.port ?? 22,
      auth,
    };
  }

  private async resolveAuth(host: Host): Promise<SshAuth> {
    if (host.inlineCredential) {
      const inline = host.inlineCredential;
      if (inline.type === 'key' && inline.keyPath) {
        const passphrase = await this.secrets.get(host.id, 'passphrase');
        return {
          kind: 'key',
          username: inline.username,
          keyPath: inline.keyPath,
          ...(passphrase ? { passphrase } : {}),
        };
      }
      const password = await this.secrets.get(host.id, 'password');
      return password
        ? { kind: 'password', username: inline.username, password }
        : { kind: 'prompt', username: inline.username };
    }

    if (host.credentialId) {
      const credential = (await this.credentials.read()).credentials.find(
        (entry) => entry.id === host.credentialId,
      );
      if (credential) {
        if (credential.type === 'key' && credential.keyPath) {
          const passphrase = await this.secrets.get(credential.id, 'passphrase');
          return {
            kind: 'key',
            username: credential.username,
            keyPath: credential.keyPath,
            ...(passphrase ? { passphrase } : {}),
          };
        }
        const password = await this.secrets.get(credential.id, 'password');
        return password
          ? { kind: 'password', username: credential.username, password }
          : { kind: 'prompt', username: credential.username };
      }
    }

    return { kind: 'prompt', username: '' };
  }

  private async writeSecrets(ownerId: string, secrets?: CredentialSecrets): Promise<void> {
    if (!secrets) return;
    // With no keychain the secret cannot be stored, but the host or credential itself
    // still should be — failing the whole save would leave the record on disk and the
    // UI unaware of it. The snapshot's `secrets` status is what tells the user, and
    // the forms warn before submit.
    if (!this.secrets.status().available) return;
    for (const kind of ['password', 'passphrase'] as const) {
      const value = secrets[kind];
      if (value === undefined) continue; // unchanged
      if (value === '') await this.secrets.clear(ownerId, kind);
      else await this.secrets.set(ownerId, kind, value);
    }
  }
}
