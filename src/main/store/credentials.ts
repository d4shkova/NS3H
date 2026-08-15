import { EMPTY_CREDENTIALS, type Credential, type CredentialsFile } from '@shared/config.js';
import { ConfigFile, configPath } from './paths.js';
import { JsonStore } from './jsonStore.js';

export function normaliseCredential(raw: unknown): Credential | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const credential = raw as Partial<Credential>;
  if (typeof credential.id !== 'string' || credential.id.length === 0) return null;
  const type = credential.type === 'key' ? 'key' : 'password';
  return {
    id: credential.id,
    name: typeof credential.name === 'string' ? credential.name : credential.id,
    type,
    username: typeof credential.username === 'string' ? credential.username : '',
    keyPath: type === 'key' && typeof credential.keyPath === 'string' ? credential.keyPath : null,
    hasPassphrase: type === 'key' && credential.hasPassphrase === true,
  };
}

export function normaliseCredentialsFile(raw: unknown): CredentialsFile {
  if (typeof raw !== 'object' || raw === null) return EMPTY_CREDENTIALS;
  const file = raw as Partial<CredentialsFile>;
  const credentials = Array.isArray(file.credentials)
    ? file.credentials
        .map(normaliseCredential)
        .filter((credential): credential is Credential => credential !== null)
    : [];
  return { version: 1, credentials };
}

export function upsertCredential(file: CredentialsFile, credential: Credential): CredentialsFile {
  const index = file.credentials.findIndex((existing) => existing.id === credential.id);
  const credentials = [...file.credentials];
  if (index >= 0) credentials[index] = credential;
  else credentials.push(credential);
  return { version: 1, credentials };
}

export function removeCredential(file: CredentialsFile, credentialId: string): CredentialsFile {
  return {
    version: 1,
    credentials: file.credentials.filter((credential) => credential.id !== credentialId),
  };
}

export function createCredentialsStore(dir?: string): JsonStore<CredentialsFile> {
  return new JsonStore<CredentialsFile>({
    file: configPath(ConfigFile.credentials, dir),
    fallback: EMPTY_CREDENTIALS,
    normalise: normaliseCredentialsFile,
  });
}
