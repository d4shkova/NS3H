import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CredentialsFile, HostsFile, Settings } from '@shared/config.js';

/** §7 — Argon2id, m=64MB, t=3, p=4. */
const ARGON = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
};

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
export const BUNDLE_VERSION = 1;
export const BUNDLE_MAGIC = 'NS3H-BUNDLE';

/** Config only — safe to email or commit (§7). */
export interface ConfigExport {
  format: 'ns3h-config';
  version: number;
  exportedAt: string;
  hosts: HostsFile;
  settings: Settings;
}

/** Everything above plus credentials and their secrets, encrypted. */
export interface BundlePayload {
  hosts: HostsFile;
  settings: Settings;
  credentials: CredentialsFile;
  /** `${ownerId}:${kind}` → secret, matching the vault's own keying. */
  secrets: Record<string, string>;
}

export interface EncryptedBundle {
  magic: typeof BUNDLE_MAGIC;
  version: number;
  exportedAt: string;
  kdf: {
    name: 'argon2id';
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    /** Base64. Header is cleartext by design (§7). */
    salt: string;
  };
  cipher: 'aes-256-gcm';
  nonce: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Argon2 is a native module pulled in only by export and import, which most launches
 * never reach — importing it here keeps its load off the startup path.
 */
async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const { hashRaw } = await import('@node-rs/argon2');
  return hashRaw(passphrase, { ...ARGON, salt });
}

export async function encryptBundle(
  payload: BundlePayload,
  passphrase: string,
): Promise<EncryptedBundle> {
  if (!passphrase) throw new Error('A passphrase is required.');

  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = await deriveKey(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    magic: BUNDLE_MAGIC,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: {
      name: 'argon2id',
      memoryCost: ARGON.memoryCost,
      timeCost: ARGON.timeCost,
      parallelism: ARGON.parallelism,
      salt: salt.toString('base64'),
    },
    cipher: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export async function decryptBundle(
  bundle: EncryptedBundle,
  passphrase: string,
): Promise<BundlePayload> {
  if (bundle?.magic !== BUNDLE_MAGIC) {
    throw new Error('That file is not an NS3H backup.');
  }
  if (bundle.version > BUNDLE_VERSION) {
    throw new Error(
      `That backup was written by a newer version of NS3H (format ${bundle.version}).`,
    );
  }

  // The header carries the parameters the file was written with, so a future change
  // to the defaults cannot make an old backup undecryptable.
  const { hashRaw } = await import('@node-rs/argon2');
  const key = await hashRaw(passphrase, {
    algorithm: ARGON.algorithm,
    memoryCost: bundle.kdf.memoryCost,
    timeCost: bundle.kdf.timeCost,
    parallelism: bundle.kdf.parallelism,
    outputLen: ARGON.outputLen,
    salt: Buffer.from(bundle.kdf.salt, 'base64'),
  });

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(bundle.nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(bundle.authTag, 'base64'));

  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(bundle.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString('utf8')) as BundlePayload;
  } catch {
    // GCM authentication covers both a wrong passphrase and a tampered file; there is
    // no way to tell them apart, and claiming otherwise would be a lie.
    throw new Error('Wrong passphrase, or the file has been altered since it was written.');
  }
}

export type ImportedFile =
  | { kind: 'config'; payload: ConfigExport }
  | { kind: 'bundle'; bundle: EncryptedBundle };

/** Import accepts either format (§7), so the file itself says which it is. */
export function identifyImport(text: string): ImportedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const record = parsed as Record<string, unknown>;
  if (record?.magic === BUNDLE_MAGIC) {
    return { kind: 'bundle', bundle: parsed as EncryptedBundle };
  }
  if (record?.format === 'ns3h-config') {
    return { kind: 'config', payload: parsed as ConfigExport };
  }
  throw new Error('That file is neither an NS3H configuration nor an NS3H backup.');
}
