/**
 * Shape-checking for the connection targets the renderer sends.
 *
 * Separate from the IPC registration itself so it can be tested without Electron: these
 * are the checks standing between a sandboxed renderer and a socket, and they are worth
 * exercising directly.
 */
import type { SshAuth, SshTarget, SshTargetInput } from '@shared/types.js';

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

/** Resolves a saved credential id into the auth to dial with, secret included. */
export type CredentialResolver = (credentialId: string) => Promise<SshAuth | null>;

export async function parseTarget(
  raw: unknown,
  resolveCredential: CredentialResolver,
): Promise<SshTarget> {
  const target = raw as SshTargetInput;
  requireString(target?.address, 'address');
  if (typeof target.port !== 'number' || target.port < 1 || target.port > 65535) {
    throw new Error('port must be between 1 and 65535');
  }

  // A saved credential arrives as its id alone. Resolving it here is what keeps its secret
  // in main — the same path a saved host's credential takes, and the reason Quick connect
  // can offer one without the renderer ever holding a password.
  if (target.auth?.kind === 'saved') {
    const auth = await resolveCredential(requireString(target.auth.credentialId, 'credentialId'));
    if (!auth) throw new Error('That credential no longer exists.');
    return { ...target, auth, name: target.name || target.address };
  }

  requireString(target?.auth?.username, 'username');
  if (!['password', 'key', 'prompt'].includes(target.auth?.kind)) {
    throw new Error('unsupported auth kind');
  }
  return { ...target, auth: target.auth, name: target.name || target.address };
}
