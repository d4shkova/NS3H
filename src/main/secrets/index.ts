import { safeStorage } from 'electron';
import { configDirectory } from '../store/paths.js';
import { join } from 'node:path';
import { SecretsStore, type Vault } from './store.js';

/** Electron's safeStorage, wrapped so the store itself stays testable. */
const electronVault: Vault = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted),
};

let store: SecretsStore | null = null;

export function secrets(): SecretsStore {
  store ??= new SecretsStore(join(configDirectory(), 'secrets.enc'), electronVault);
  return store;
}

export { SecretsUnavailableError } from './store.js';
