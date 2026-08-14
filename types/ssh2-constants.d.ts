/**
 * @types/ssh2 does not cover the internal constants module, but its supported-algorithm
 * lists are the only reliable way to know what this build of ssh2 can actually offer.
 * It is CommonJS, so it is consumed through the default export.
 */
declare module 'ssh2/lib/protocol/constants.js' {
  interface Ssh2Constants {
    SUPPORTED_KEX: string[];
    SUPPORTED_SERVER_HOST_KEY: string[];
    SUPPORTED_CIPHER: string[];
    SUPPORTED_MAC: string[];
    DEFAULT_KEX: string[];
    DEFAULT_SERVER_HOST_KEY: string[];
    DEFAULT_CIPHER: string[];
    DEFAULT_MAC: string[];
  }
  const constants: Ssh2Constants;
  export default constants;
}
