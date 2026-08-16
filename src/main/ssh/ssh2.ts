import { createRequire } from 'node:module';
import type { Client as SshClientClass, utils as sshUtils } from 'ssh2';
import { installLegacyDhGroups } from './legacyDh.js';

/**
 * Single entry point for ssh2, because load order matters: the legacy DH shim has to
 * be installed before ssh2's kex module captures `createDiffieHellmanGroup` off the
 * crypto module. A static `import` of ssh2 anywhere in the bundle would be evaluated
 * before this file's body runs, so ssh2 is pulled in with `createRequire` instead —
 * which also side-steps the CommonJS/ESM interop the package needs.
 *
 * The require is deferred to the first SSH operation rather than run at import: ssh2
 * and its crypto bindings cost ~60 ms to load, and paying that before the window is
 * created delays first paint for a launch that may never open an SSH session. The
 * shim still installs first — it only touches `node:crypto`, and it runs here, in the
 * module body, before anything can reach the loader below.
 */
export const dhShim = installLegacyDhGroups();

const require = createRequire(import.meta.url);

interface Ssh2Constants {
  SUPPORTED_KEX: string[];
  SUPPORTED_SERVER_HOST_KEY: string[];
  SUPPORTED_CIPHER: string[];
  SUPPORTED_MAC: string[];
}

interface LoadedSsh2 {
  Client: typeof SshClientClass;
  utils: typeof sshUtils;
  supported: AlgorithmSupport;
}

/** What this build of ssh2 can actually implement, in AlgorithmSet shape. */
export interface AlgorithmSupport {
  kex: string[];
  serverHostKey: string[];
  cipher: string[];
  hmac: string[];
}

let loaded: LoadedSsh2 | null = null;

function ssh2(): LoadedSsh2 {
  if (loaded) return loaded;

  const module = require('ssh2') as typeof import('ssh2');
  const constants = require('ssh2/lib/protocol/constants.js') as Ssh2Constants;

  loaded = {
    Client: module.Client,
    utils: module.utils,
    supported: {
      kex: constants.SUPPORTED_KEX,
      serverHostKey: constants.SUPPORTED_SERVER_HOST_KEY,
      cipher: constants.SUPPORTED_CIPHER,
      hmac: constants.SUPPORTED_MAC,
    },
  };
  return loaded;
}

export function sshClientClass(): typeof SshClientClass {
  return ssh2().Client;
}

export function sshUtilities(): typeof sshUtils {
  return ssh2().utils;
}

export function supportedAlgorithms(): AlgorithmSupport {
  return ssh2().supported;
}
