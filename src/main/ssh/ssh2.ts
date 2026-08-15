import { createRequire } from 'node:module';
import { installLegacyDhGroups } from './legacyDh.js';

/**
 * Single entry point for ssh2, because load order matters: the legacy DH shim has to
 * be installed before ssh2's kex module captures `createDiffieHellmanGroup` off the
 * crypto module. A static `import` of ssh2 anywhere in the bundle would be evaluated
 * before this file's body runs, so ssh2 is pulled in with `createRequire` instead —
 * which also side-steps the CommonJS/ESM interop the package needs.
 */
export const dhShim = installLegacyDhGroups();

const require = createRequire(import.meta.url);

const ssh2 = require('ssh2') as typeof import('ssh2');

const constants = require('ssh2/lib/protocol/constants.js') as {
  SUPPORTED_KEX: string[];
  SUPPORTED_SERVER_HOST_KEY: string[];
  SUPPORTED_CIPHER: string[];
  SUPPORTED_MAC: string[];
};

export const { Client, utils } = ssh2;

/** What this build of ssh2 can actually implement, in AlgorithmSet shape. */
export const SUPPORTED_ALGORITHMS = {
  kex: constants.SUPPORTED_KEX,
  serverHostKey: constants.SUPPORTED_SERVER_HOST_KEY,
  cipher: constants.SUPPORTED_CIPHER,
  hmac: constants.SUPPORTED_MAC,
};
