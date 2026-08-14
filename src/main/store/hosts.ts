import {
  EMPTY_HOSTS,
  type Folder,
  type Host,
  type HostsFile,
  type InlineCredential,
  type SerialConfig,
} from '@shared/config.js';
import { ConfigFile, configPath } from './paths.js';
import { JsonStore } from './jsonStore.js';

const PROTOCOLS = ['ssh', 'telnet', 'serial'] as const;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normaliseSerial(raw: unknown): SerialConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const serial = raw as Partial<SerialConfig>;
  if (typeof serial.path !== 'string' || serial.path.length === 0) return null;
  return {
    path: serial.path,
    baudRate: typeof serial.baudRate === 'number' ? serial.baudRate : 9600,
    dataBits: serial.dataBits === 7 ? 7 : 8,
    parity: serial.parity === 'even' || serial.parity === 'odd' ? serial.parity : 'none',
    stopBits: serial.stopBits === 2 ? 2 : 1,
    flowControl:
      serial.flowControl === 'rtscts' || serial.flowControl === 'xonxoff'
        ? serial.flowControl
        : 'none',
  };
}

function normaliseInline(raw: unknown): InlineCredential | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const inline = raw as Partial<InlineCredential>;
  if (inline.type !== 'password' && inline.type !== 'key') return null;
  return {
    type: inline.type,
    username: asString(inline.username),
    keyPath: asNullableString(inline.keyPath),
    hasPassphrase: inline.hasPassphrase === true,
  };
}

export function normaliseHost(raw: unknown): Host | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const host = raw as Partial<Host>;
  if (typeof host.id !== 'string' || host.id.length === 0) return null;

  const protocol = PROTOCOLS.includes(host.protocol as never) ? host.protocol! : 'ssh';
  const credentialId = asNullableString(host.credentialId);
  const inlineCredential = normaliseInline(host.inlineCredential);

  return {
    id: host.id,
    name: asString(host.name, host.id),
    protocol,
    folderId: asNullableString(host.folderId),
    address: asNullableString(host.address),
    port: typeof host.port === 'number' ? host.port : null,
    // §4.1 — the two are mutually exclusive; a shared credential wins if a file has both.
    credentialId,
    inlineCredential: credentialId ? null : inlineCredential,
    logging: host.logging !== false,
    serial: protocol === 'serial' ? normaliseSerial(host.serial) : null,
    createdAt: asString(host.createdAt, new Date().toISOString()),
  };
}

export function normaliseFolder(raw: unknown): Folder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const folder = raw as Partial<Folder>;
  if (typeof folder.id !== 'string' || folder.id.length === 0) return null;
  return {
    id: folder.id,
    name: asString(folder.name, folder.id),
    parentId: asNullableString(folder.parentId),
  };
}

export function normaliseHostsFile(raw: unknown): HostsFile {
  if (typeof raw !== 'object' || raw === null) return EMPTY_HOSTS;
  const file = raw as Partial<HostsFile>;
  const folders = Array.isArray(file.folders)
    ? file.folders.map(normaliseFolder).filter((folder): folder is Folder => folder !== null)
    : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const hosts = Array.isArray(file.hosts)
    ? file.hosts.map(normaliseHost).filter((host): host is Host => host !== null)
    : [];

  return {
    version: 1,
    folders: folders.map((folder) => ({
      ...folder,
      // A parent that no longer exists would hide the folder entirely.
      parentId: folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null,
    })),
    hosts: hosts.map((host) => ({
      ...host,
      folderId: host.folderId && folderIds.has(host.folderId) ? host.folderId : null,
    })),
  };
}

export function upsertHost(file: HostsFile, host: Host): HostsFile {
  const index = file.hosts.findIndex((existing) => existing.id === host.id);
  const hosts = [...file.hosts];
  if (index >= 0) hosts[index] = host;
  else hosts.push(host);
  return { ...file, hosts };
}

export function removeHost(file: HostsFile, hostId: string): HostsFile {
  return { ...file, hosts: file.hosts.filter((host) => host.id !== hostId) };
}

export function upsertFolder(file: HostsFile, folder: Folder): HostsFile {
  const index = file.folders.findIndex((existing) => existing.id === folder.id);
  const folders = [...file.folders];
  if (index >= 0) folders[index] = folder;
  else folders.push(folder);
  return { ...file, folders };
}

/** Deleting a folder keeps its contents — they move to the root, never vanish. */
export function removeFolder(file: HostsFile, folderId: string): HostsFile {
  return {
    version: 1,
    folders: file.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => (folder.parentId === folderId ? { ...folder, parentId: null } : folder)),
    hosts: file.hosts.map((host) =>
      host.folderId === folderId ? { ...host, folderId: null } : host,
    ),
  };
}

/** Clears references to a credential that no longer exists. */
export function detachCredential(file: HostsFile, credentialId: string): HostsFile {
  return {
    ...file,
    hosts: file.hosts.map((host) =>
      host.credentialId === credentialId ? { ...host, credentialId: null } : host,
    ),
  };
}

export function createHostsStore(dir?: string): JsonStore<HostsFile> {
  return new JsonStore<HostsFile>({
    file: configPath(ConfigFile.hosts, dir),
    fallback: EMPTY_HOSTS,
    normalise: normaliseHostsFile,
  });
}
