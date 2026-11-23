// Přenosové vrstvy pro VDCP. Každá má open(), close(), write(buf)
// a vydává 'data', 'open', 'close', 'error'.
//
//   serial – USB→RS-422 převodník (COM port), 38400 Bd, 8 bitů, lichá parita, 1 stop bit
//   tcp    – VDCP přes TCP (např. převodník sériová linka ↔ Ethernet)
//   sim    – vestavěný simulátor XT3, bez hardwaru

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { Xt3Simulator } from '../sim/xt3-sim.js';

export class SerialTransport extends EventEmitter {
  constructor({ path, baudRate = 38400, parity = 'odd', dataBits = 8, stopBits = 1 }) {
    super();
    this.opts = { path, baudRate, parity, dataBits, stopBits };
    this.port = null;
  }

  async open() {
    let SerialPort;
    try {
      ({ SerialPort } = await import('serialport'));
    } catch (e) {
      throw new Error('Knihovna serialport není nainstalovaná (spusť npm install).');
    }
    if (!this.opts.path) throw new Error('Není vybraný COM port.');
    await new Promise((resolve, reject) => {
      this.port = new SerialPort({ ...this.opts, autoOpen: false });
      this.port.on('data', (d) => this.emit('data', d));
      this.port.on('close', () => this.emit('close'));
      this.port.on('error', (e) => this.emit('error', e));
      this.port.open((err) => (err ? reject(err) : resolve()));
    });
    this.emit('open');
  }

  write(buf) {
    this.port?.write(buf);
  }

  async close() {
    if (!this.port?.isOpen) return;
    await new Promise((r) => this.port.close(() => r()));
  }
}

export class TcpTransport extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 9000 }) {
    super();
    this.opts = { host, port };
    this.sock = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.opts);
      sock.setNoDelay(true);
      sock.once('connect', () => {
        this.sock = sock;
        this.emit('open');
        resolve();
      });
      sock.once('error', reject);
      sock.on('data', (d) => this.emit('data', d));
      sock.on('close', () => this.emit('close'));
      sock.on('error', (e) => this.emit('error', e));
    });
  }

  write(buf) {
    this.sock?.write(buf);
  }

  async close() {
    this.sock?.destroy();
  }
}

// Simulátor sdílený mezi kanály (PGM i PRV vidí stejné klipy).
let sharedSim = null;
export function getSharedSimulator() {
  if (!sharedSim) sharedSim = new Xt3Simulator();
  return sharedSim;
}

export class SimTransport extends EventEmitter {
  constructor({ channel = 'PGM' } = {}) {
    super();
    this.channel = channel;
  }

  async open() {
    this.port = getSharedSimulator().attach(this.channel, (buf) => {
      setTimeout(() => this.emit('data', buf), 2);
    });
    this.emit('open');
  }

  write(buf) {
    this.port?.receive(buf);
  }

  async close() {
    this.port?.detach();
    this.port = null;
  }
}

export function createTransport(cfg, channel) {
  switch (cfg.transport) {
    case 'serial':
      return new SerialTransport({ path: cfg.path, baudRate: cfg.baudRate, parity: cfg.parity });
    case 'tcp':
      return new TcpTransport({ host: cfg.host, port: cfg.tcpPort });
    case 'sim':
    default:
      return new SimTransport({ channel });
  }
}

export async function listSerialPorts() {
  try {
    const { SerialPort } = await import('serialport');
    return await SerialPort.list();
  } catch {
    return [];
  }
}
