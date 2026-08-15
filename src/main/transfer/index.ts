import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ConfigSnapshot } from '@shared/config.js';
import type { ImportPreview, ImportRequest } from '@shared/transfer.js';
import type { ConfigService } from '../store/index.js';
import type { SecretsStore } from '../secrets/store.js';
import {
  decryptBundle,
  encryptBundle,
  identifyImport,
  type BundlePayload,
  type ConfigExport,
} from './bundle.js';
import { applyImport, missingKeyPaths, planImport } from './merge.js';

function stamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function configFileName(date?: Date): string {
  return `ns3h-config-${stamp(date)}.json`;
}

export function bundleFileName(date?: Date): string {
  return `ns3h-backup-${stamp(date)}.ns3h`;
}

/**
 * §7 — two separate actions. Configuration alone is plain readable JSON with no
 * secrets; the full backup adds credentials and their secrets under a passphrase.
 * Private keys are never included, only the path recorded for them.
 */
export class TransferService {
  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsStore,
  ) {}

  async exportConfig(path: string): Promise<void> {
    const snapshot = await this.config.snapshot();
    const payload: ConfigExport = {
      format: 'ns3h-config',
      version: 1,
      exportedAt: new Date().toISOString(),
      hosts: snapshot.hosts,
      settings: snapshot.settings,
    };
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async exportBundle(path: string, passphrase: string): Promise<void> {
    const snapshot = await this.config.snapshot();
    const secrets: Record<string, string> = {};

    // Only what the vault actually holds; a credential with no stored secret simply
    // travels without one and prompts on the far side.
    for (const credential of snapshot.credentials.credentials) {
      for (const kind of ['password', 'passphrase'] as const) {
        const value = await this.secrets.get(credential.id, kind);
        if (value !== null) secrets[`${credential.id}:${kind}`] = value;
      }
    }
    for (const host of snapshot.hosts.hosts) {
      if (!host.inlineCredential) continue;
      for (const kind of ['password', 'passphrase'] as const) {
        const value = await this.secrets.get(host.id, kind);
        if (value !== null) secrets[`${host.id}:${kind}`] = value;
      }
    }

    const payload: BundlePayload = {
      hosts: snapshot.hosts,
      settings: snapshot.settings,
      credentials: snapshot.credentials,
      secrets,
    };
    const bundle = await encryptBundle(payload, passphrase);
    await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  }

  /** Reads a file and reports what importing it would do, without doing it. */
  async preview(path: string, passphrase?: string): Promise<ImportPreview> {
    const identified = identifyImport(await readFile(path, 'utf8'));
    const snapshot = await this.config.snapshot();

    if (identified.kind === 'config') {
      const plan = planImport(snapshot, { hosts: identified.payload.hosts });
      return { kind: 'config', ...plan, missingKeys: [] };
    }

    if (!passphrase) {
      return {
        kind: 'bundle',
        needsPassphrase: true,
        added: { hosts: 0, folders: 0, credentials: 0 },
        collisions: [],
        missingKeys: [],
      };
    }

    const payload = await decryptBundle(identified.bundle, passphrase);
    const plan = planImport(snapshot, payload);
    return {
      kind: 'bundle',
      ...plan,
      missingKeys: missingKeyPaths(payload.credentials.credentials, existsSync).map(
        (credential) => ({ id: credential.id, name: credential.name, keyPath: credential.keyPath! }),
      ),
    };
  }

  /** Applies the import with the user's per-item decisions. */
  async apply(request: ImportRequest): Promise<ConfigSnapshot> {
    const identified = identifyImport(await readFile(request.path, 'utf8'));
    const snapshot = await this.config.snapshot();

    const incoming =
      identified.kind === 'config'
        ? { hosts: identified.payload.hosts }
        : await decryptBundle(identified.bundle, request.passphrase ?? '');

    const merged = applyImport(snapshot, incoming, request.resolutions ?? {});

    for (const folder of merged.hosts.folders) await this.config.saveFolder(folder);
    for (const host of merged.hosts.hosts) await this.config.saveHost(host);
    for (const credential of merged.credentials.credentials) {
      await this.config.saveCredential(credential);
    }

    // Secrets ride along only from a full backup, and only for items being written.
    if (identified.kind === 'bundle' && 'secrets' in incoming) {
      for (const [key, value] of Object.entries(incoming.secrets)) {
        const [ownerId, kind] = key.split(':');
        if (kind !== 'password' && kind !== 'passphrase') continue;
        const overwritten = request.resolutions?.[ownerId];
        const isNew = !snapshot.credentials.credentials.some((entry) => entry.id === ownerId)
          && !snapshot.hosts.hosts.some((entry) => entry.id === ownerId);
        if (isNew || overwritten) {
          try {
            await this.secrets.set(ownerId, kind, value);
          } catch {
            // No keychain on this machine: the record still imports and will prompt.
          }
        }
      }
    }

    return this.config.snapshot();
  }
}
