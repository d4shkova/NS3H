import { readdir } from 'node:fs/promises';
import { SerialPort } from 'serialport';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  /** `/dev/ttyUSB0 — FTDI FT232R` (§3.6): users do not recognise bare paths. */
  label: string;
}

export function describePort(port: {
  path: string;
  manufacturer?: string;
  friendlyName?: string;
}): string {
  const detail = port.friendlyName ?? port.manufacturer;
  return detail ? `${port.path} — ${detail}` : port.path;
}

/**
 * Enumerates serial ports. Refreshed every time the dropdown opens, because USB
 * adapters get plugged in mid-session.
 *
 * `SerialPort.list()` shells out to `udevadm` on Linux and throws where it is absent
 * (containers, minimal installs). That should degrade to a usable list rather than an
 * error, so the device nodes are read directly as a fallback.
 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      label: describePort(port),
    }));
  } catch (error) {
    console.error('NS3H: SerialPort.list() failed, falling back to /dev:', error);
    return listDevNodes();
  }
}

const SERIAL_DEVICE = /^(ttyUSB|ttyACM|ttyS|ttyAMA|cu\.|tty\.)/;

async function listDevNodes(): Promise<SerialPortInfo[]> {
  if (process.platform === 'win32') return [];
  try {
    const entries = await readdir('/dev');
    return entries
      .filter((entry) => SERIAL_DEVICE.test(entry))
      .sort()
      .map((entry) => ({ path: `/dev/${entry}`, label: `/dev/${entry}` }));
  } catch {
    return [];
  }
}
