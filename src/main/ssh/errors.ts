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

/**
 * A device that refuses the SFTP channel is the normal case, not a fault: most switches
 * and routers run an SSH server with no SFTP subsystem at all, and ssh2 reports that as
 * a bare "Channel open failure:" with no reason text. Say what it means, and drop the
 * ssh2 stack — it points at protocol internals and reads like a crash in the log for
 * something the device did on purpose.
 */
export function explainSftpRefusal(error: unknown, address: string): Error {
  const raw = ((error as ErrorLike)?.message ?? '').trim();
  // "(SSH) Channel open failure: <reason>" — the prefix says nothing the sentence below
  // does not, and the reason is often empty, so only the reason is kept.
  const match = /channel open failure:?\s*(.*)$/i.exec(raw);
  const reason = (match ? match[1] : raw.replace(/^\(SSH\)\s*/, ''))
    .trim()
    .replace(/[.:]$/, '');
  const explained = new Error(
    `${address} refused an SFTP channel${reason ? ` (${reason})` : ''}. ` +
      'Most switches and routers run SSH without an SFTP subsystem — check whether the ' +
      'device has one enabled (on IOS, `ip ssh server sftp`), or move the file another way.',
  );
  explained.stack = `${explained.name}: ${explained.message}`;
  return explained;
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
