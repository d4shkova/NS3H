import type {
  Credential,
  CredentialsFile,
  Folder,
  Host,
  HostsFile,
} from '@shared/config.js';

export type CollisionKind = 'host' | 'folder' | 'credential';

export interface Collision {
  kind: CollisionKind;
  id: string;
  /** What is on this machine now. */
  existing: string;
  /** What the file being imported would put there. */
  incoming: string;
}

export interface ImportPlan {
  added: { hosts: number; folders: number; credentials: number };
  collisions: Collision[];
}

/** Per-id decisions from the user: true to overwrite, false or missing to keep. */
export type Resolutions = Record<string, boolean>;

function describeHost(host: Host): string {
  if (host.protocol === 'serial') return `${host.name} (serial ${host.serial?.path ?? '?'})`;
  return `${host.name} (${host.protocol} ${host.address ?? '?'}:${host.port ?? ''})`;
}

/**
 * §7 — import merges rather than replacing. New ids are added; colliding ids are
 * reported so the user decides per item. Nothing is overwritten without being asked.
 */
export function planImport(
  current: { hosts: HostsFile; credentials: CredentialsFile },
  incoming: { hosts?: HostsFile; credentials?: CredentialsFile },
): ImportPlan {
  const collisions: Collision[] = [];
  const added = { hosts: 0, folders: 0, credentials: 0 };

  for (const folder of incoming.hosts?.folders ?? []) {
    const existing = current.hosts.folders.find((entry) => entry.id === folder.id);
    if (!existing) added.folders += 1;
    else if (existing.name !== folder.name) {
      collisions.push({
        kind: 'folder',
        id: folder.id,
        existing: existing.name,
        incoming: folder.name,
      });
    }
  }

  for (const host of incoming.hosts?.hosts ?? []) {
    const existing = current.hosts.hosts.find((entry) => entry.id === host.id);
    if (!existing) added.hosts += 1;
    else {
      collisions.push({
        kind: 'host',
        id: host.id,
        existing: describeHost(existing),
        incoming: describeHost(host),
      });
    }
  }

  for (const credential of incoming.credentials?.credentials ?? []) {
    const existing = current.credentials.credentials.find(
      (entry) => entry.id === credential.id,
    );
    if (!existing) added.credentials += 1;
    else {
      collisions.push({
        kind: 'credential',
        id: credential.id,
        existing: `${existing.name} (${existing.type}, ${existing.username})`,
        incoming: `${credential.name} (${credential.type}, ${credential.username})`,
      });
    }
  }

  return { added, collisions };
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  resolutions: Resolutions,
): T[] {
  const result = [...current];
  for (const item of incoming) {
    const index = result.findIndex((entry) => entry.id === item.id);
    if (index < 0) result.push(item);
    // A collision is only overwritten when the user said so.
    else if (resolutions[item.id]) result[index] = item;
  }
  return result;
}

export function applyImport(
  current: { hosts: HostsFile; credentials: CredentialsFile },
  incoming: { hosts?: HostsFile; credentials?: CredentialsFile },
  resolutions: Resolutions,
): { hosts: HostsFile; credentials: CredentialsFile } {
  return {
    hosts: {
      version: 1,
      folders: mergeById<Folder>(
        current.hosts.folders,
        incoming.hosts?.folders ?? [],
        resolutions,
      ),
      hosts: mergeById<Host>(current.hosts.hosts, incoming.hosts?.hosts ?? [], resolutions),
    },
    credentials: {
      version: 1,
      credentials: mergeById<Credential>(
        current.credentials.credentials,
        incoming.credentials?.credentials ?? [],
        resolutions,
      ),
    },
  };
}

/**
 * §7 — a credential whose key file is missing at the recorded path is flagged so the
 * UI can offer to locate it. Private keys are never carried in a backup.
 */
export function missingKeyPaths(
  credentials: Credential[],
  exists: (path: string) => boolean,
): Credential[] {
  return credentials.filter(
    (credential) => credential.type === 'key' && credential.keyPath && !exists(credential.keyPath),
  );
}
