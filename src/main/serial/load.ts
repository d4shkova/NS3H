import type { SerialPort as SerialPortClass } from 'serialport';

/**
 * `serialport` is a native module and costs ~20 ms to load, all of it before the window
 * can be created. Most launches never touch a serial port, so it is imported on first
 * use — opening a port, or opening the port list — instead of at startup.
 */
let pending: Promise<typeof SerialPortClass> | null = null;

export function loadSerialPort(): Promise<typeof SerialPortClass> {
  pending ??= import('serialport').then((module) => module.SerialPort);
  return pending;
}
