// VDCP klient (řadič). Posílá příkazy po jednom, čeká na ACK/NAK nebo
// odpověď, hlídá timeout.
//
// BEZPEČNOST: klient zná jen příkazy z ALLOWED. Nahrávání (RECORD, RECORD INIT),
// mazání (DELETE ID) a další destruktivní příkazy tu záměrně nejsou a nedají
// se poslat ani omylem.

import { EventEmitter } from 'node:events';
import {
  TYPE, VdcpParser, buildMessage, describeNak, encodeId, decodeFixedId,
  decodeTimecode, hexDump,
} from './frame.js';

const ALLOWED = new Map([
  // [typ, cmd2] -> název
  [`${TYPE.SYSTEM}:${0x0c}`, 'LOCAL DISABLE'],
  [`${TYPE.SYSTEM}:${0x0d}`, 'LOCAL ENABLE'],
  [`${TYPE.IMMEDIATE}:${0x00}`, 'STOP'],
  [`${TYPE.IMMEDIATE}:${0x01}`, 'PLAY'],
  [`${TYPE.IMMEDIATE}:${0x04}`, 'STILL'],
  [`${TYPE.IMMEDIATE}:${0x06}`, 'CONTINUE'],
  [`${TYPE.IMMEDIATE}:${0x07}`, 'JOG'],
  [`${TYPE.IMMEDIATE}:${0x08}`, 'VARI PLAY'],
  [`${TYPE.PRESET}:${0x22}`, 'SELECT PORT'],
  [`${TYPE.PRESET}:${0x24}`, 'PLAY CUE'],
  [`${TYPE.VAR_PRESET}:${0x24}`, 'PLAY CUE (var ID)'],
  [`${TYPE.PRESET}:${0x25}`, 'CUE WITH DATA'],
  [`${TYPE.VAR_PRESET}:${0x25}`, 'CUE WITH DATA (var ID)'],
  [`${TYPE.SENSE}:${0x01}`, 'OPEN PORT'],
  [`${TYPE.SENSE}:${0x02}`, 'NEXT'],
  [`${TYPE.SENSE}:${0x05}`, 'PORT STATUS'],
  [`${TYPE.SENSE}:${0x06}`, 'POSITION'],
  [`${TYPE.SENSE}:${0x07}`, 'ACTIVE ID'],
  [`${TYPE.SENSE}:${0x08}`, 'DEVICE TYPE'],
  [`${TYPE.SENSE}:${0x11}`, 'ID LIST'],
  [`${TYPE.SENSE}:${0x14}`, 'ID SIZE'],
  [`${TYPE.VAR_SENSE}:${0x14}`, 'ID SIZE (var ID)'],
  [`${TYPE.SENSE}:${0x16}`, 'ID REQUEST'],
]);

export class VdcpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Bity Status 1 (port status). Pozor: podle dokumentace, na EVS neověřeno.
export function decodeStatus1(b) {
  return {
    idle: !!(b & 0x01),
    cueing: !!(b & 0x02),
    playing: !!(b & 0x04),
    still: !!(b & 0x08),
    jog: !!(b & 0x10),
    variPlay: !!(b & 0x20),
    busy: !!(b & 0x40),
    cueDone: !!(b & 0x80),
  };
}

export class VdcpClient extends EventEmitter {
  /**
   * @param transport objekt s write(buf), on('data'), viz src/transport
   * @param opts.unit adresa jednotky (dolní nibble CMD-1), obvykle 0
   * @param opts.timeoutMs jak dlouho čekat na odpověď (VDCP: 100 ms)
   * @param opts.statusBitmap DATA-1 pro PORT STATUS REQUEST
   */
  constructor(transport, { unit = 0, timeoutMs = 150, retries = 1, statusBitmap = 0x01, name = 'PGM' } = {}) {
    super();
    this.transport = transport;
    this.unit = unit;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.statusBitmap = statusBitmap;
    this.name = name;
    this.queue = Promise.resolve();
    this.pending = null;
    this.parser = new VdcpParser();
    this.parser.on('ack', () => this._reply({ kind: 'ack' }));
    this.parser.on('nak', (code) => this._reply({ kind: 'nak', code }));
    this.parser.on('message', (msg) => this._reply({ kind: 'message', msg }));
    this.parser.on('badchecksum', (raw) => this._log('rx', `špatný checksum: ${hexDump(raw)}`));
    this.parser.on('garbage', (b) => this._log('rx', `neočekávaný bajt ${b.toString(16)}`));
    this._onData = (chunk) => {
      this._log('rx', hexDump(chunk));
      this.parser.push(chunk);
    };
    transport.on('data', this._onData);
  }

  dispose() {
    this.transport.off?.('data', this._onData);
  }

  _log(dir, text) {
    this.emit('log', { channel: this.name, dir, text, t: Date.now() });
  }

  _reply(r) {
    const p = this.pending;
    if (!p) {
      this._log('rx', `odpověď bez dotazu: ${r.kind}`);
      return;
    }
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(r);
  }

  /** Pošle povolený příkaz. Vrací ACK / data odpovědi. */
  send(type, cmd2, data = []) {
    const name = ALLOWED.get(`${type}:${cmd2}`);
    if (!name) {
      return Promise.reject(new VdcpError(`Příkaz ${type.toString(16)}X.${cmd2.toString(16)} není povolen`));
    }
    const run = () => this._sendNow(name, type, cmd2, data);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async _sendNow(name, type, cmd2, data) {
    const msg = buildMessage(type, this.unit, cmd2, data);
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      this.parser.reset();
      const reply = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pending = null;
          resolve({ kind: 'timeout' });
        }, this.timeoutMs);
        this.pending = { resolve, timer };
        this._log('tx', `${name}: ${hexDump(msg)}`);
        this.transport.write(msg);
      });
      if (reply.kind === 'ack') return { ack: true };
      if (reply.kind === 'message') return reply.msg;
      if (reply.kind === 'nak') {
        throw new VdcpError(`${name}: NAK (${describeNak(reply.code)})`, reply.code);
      }
      lastErr = new VdcpError(`${name}: server neodpověděl (timeout)`);
    }
    throw lastErr;
  }

  // --- Příkazy ---------------------------------------------------------------

  localDisable() { return this.send(TYPE.SYSTEM, 0x0c); }
  stop() { return this.send(TYPE.IMMEDIATE, 0x00); }
  play() { return this.send(TYPE.IMMEDIATE, 0x01); }
  still() { return this.send(TYPE.IMMEDIATE, 0x04); }
  continue() { return this.send(TYPE.IMMEDIATE, 0x06); }

  cue(id) {
    const { variable, bytes } = encodeId(id);
    return this.send(variable ? TYPE.VAR_PRESET : TYPE.PRESET, 0x24, bytes);
  }

  selectPort(port) {
    return this.send(TYPE.PRESET, 0x22, [port & 0xff]);
  }

  async openPort(port, lock = true) {
    const r = await this.send(TYPE.SENSE, 0x01, [port & 0xff, lock ? 1 : 0]);
    return r.data[0] === 1;
  }

  async portStatus() {
    const r = await this.send(TYPE.SENSE, 0x05, [this.statusBitmap]);
    // odpověď: [bitmap, blok...]
    const raw = [...r.data];
    const status1 = raw.length >= 2 ? raw[1] : raw[0];
    return { raw, status1, ...decodeStatus1(status1 ?? 0) };
  }

  async position(kind = 1) {
    const r = await this.send(TYPE.SENSE, 0x06, [kind]);
    const d = r.data;
    if (d.length < 4) return null;
    return decodeTimecode([...d.subarray(d.length - 4)]);
  }

  async activeId() {
    const r = await this.send(TYPE.SENSE, 0x07);
    const d = r.data;
    if (d.length < 9) return { active: false, id: null };
    return { active: d[0] !== 0, id: decodeFixedId(d.subarray(1, 9)) || null };
  }

  async idSize(id) {
    const { variable, bytes } = encodeId(id);
    const r = await this.send(variable ? TYPE.VAR_SENSE : TYPE.SENSE, 0x14, bytes);
    const d = r.data;
    if (d.length < 4) return null;
    return decodeTimecode([...d.subarray(d.length - 4)]);
  }

  /** Načte všechna ID klipů na serveru (ID LIST + opakovaně NEXT). */
  async idList({ maxBatches = 1000 } = {}) {
    const all = [];
    let r = await this.send(TYPE.SENSE, 0x11);
    for (let i = 0; i < maxBatches; i++) {
      const { ids, remaining } = parseIdListReply(r.data);
      all.push(...ids);
      const more = remaining === undefined ? ids.length >= 10 : remaining > 0;
      if (!more || ids.length === 0) break;
      r = await this.send(TYPE.SENSE, 0x02);
    }
    return [...new Set(all)];
  }
}

// Odpověď ID LIST / NEXT: [počet zbývajících (2 B)] + až 10 ID po 8 bajtech.
// Některé implementace počet neposílají, proto se formát odhaduje z délky.
export function parseIdListReply(data) {
  let offset = 0;
  let remaining;
  if (data.length >= 2 && (data.length - 2) % 8 === 0) {
    remaining = (data[0] << 8) | data[1];
    offset = 2;
  } else if (data.length % 8 !== 0) {
    return { ids: [], remaining: 0 };
  }
  const ids = [];
  for (let i = offset; i + 8 <= data.length; i += 8) {
    const id = decodeFixedId(data.subarray(i, i + 8));
    if (id) ids.push(id);
  }
  return { ids, remaining };
}
