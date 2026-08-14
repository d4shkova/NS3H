export type FailureKind =
  /** The two sides share no algorithm, or the peer rejected our KEXINIT. */
  | 'negotiation'
  /** Credentials were refused — worth re-prompting rather than dropping the session. */
  | 'auth'
  /** DNS, refused, unreachable, timed out. */
  | 'network'
  | 'other';

export interface SshFailure {
  kind: FailureKind;
  message: string;
}

interface ErrorLike {
  message?: string;
  level?: string;
  code?: string;
}

/**
 * ssh2 reports failures through a mix of `level`, `code`, and free text. Old gear
 * that chokes on an oversized KEXINIT usually surfaces as a protocol error or an
 * abruptly closed socket during the handshake, which is what the legacy rung of the
 * ladder exists for — so an early socket close counts as `negotiation`.
 */
export function classifySshError(error: unknown, handshakeCompleted: boolean): SshFailure {
  const err = (error ?? {}) as ErrorLike;
  const message = err.message ?? String(error);
  const level = err.level ?? '';
  const code = err.code ?? '';

  if (level === 'client-authentication' || /authentication methods failed/i.test(message)) {
    return { kind: 'auth', message };
  }

  if (
    /handshake|no matching|kexinit|key exchange|unsupported|protocol/i.test(message) ||
    level === 'protocol'
  ) {
    return { kind: 'negotiation', message };
  }

  if (!handshakeCompleted && (code === 'ECONNRESET' || /socket closed|ended early/i.test(message))) {
    return { kind: 'negotiation', message };
  }

  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(code) ||
    level === 'client-timeout' ||
    level === 'client-socket' ||
    /timed out|timeout/i.test(message)
  ) {
    return { kind: 'network', message };
  }

  return { kind: 'other', message };
}

/** Turn a network failure into wording that names the likely cause. */
export function explainNetworkError(error: unknown, address: string, port: number): string {
  const code = (error as ErrorLike)?.code ?? '';
  switch (code) {
    case 'ENOTFOUND':
      return `Could not resolve ${address}. Check the hostname or use an IP address.`;
    case 'ECONNREFUSED':
      return `${address} refused the connection on port ${port}. Is SSH enabled and listening on that port?`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `No route to ${address}. Check the interface, VPN, or routing table.`;
    case 'ETIMEDOUT':
      return `Timed out connecting to ${address}:${port}. A firewall or ACL may be dropping the traffic.`;
    default:
      return (error as ErrorLike)?.message ?? String(error);
  }
}
