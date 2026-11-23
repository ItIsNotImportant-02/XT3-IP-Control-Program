// VDCP (Video Disk Control Protocol) – rámování zpráv.
//
// Zpráva: STX BC CMD-1 CMD-2 [DATA...] CS
//   STX  = 02h
//   BC   = počet bajtů mezi BC a CS (CMD-1 + CMD-2 + DATA)
//   CMD-1 = horní nibble typ příkazu, dolní nibble adresa jednotky
//   CS   = dvojkový doplněk součtu bajtů CMD-1 .. poslední DATA
// Odpověď na příkazy typu 0/1/2: ACK (04h) nebo NAK (05h + chybový bajt).
// Odpověď na dotazy typu 3: zpráva se stejným rámcem, CMD-2 s nastaveným MSB.
//
// Zdroj: Imagine Communications, VDCP Protocol Guide rev. 20 (2023).

import { EventEmitter } from 'node:events';

export const STX = 0x02;
export const ACK = 0x04;
export const NAK = 0x05;

export const TYPE = Object.freeze({
  SYSTEM: 0x0,
  IMMEDIATE: 0x1,
  PRESET: 0x2,
  SENSE: 0x3,
  VAR_SYSTEM: 0x8,
  VAR_PRESET: 0xa,
  VAR_SENSE: 0xb,
});

export const NAK_BITS = Object.freeze([
  [0x80, 'timeout'],
  [0x40, 'framing'],
  [0x20, 'overrun'],
  [0x10, 'parity'],
  [0x08, 'checksum'],
  [0x04, 'undefined command'],
]);

export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return (0x100 - sum) & 0xff;
}

export function buildMessage(type, unit, cmd2, data = []) {
  const body = [((type & 0x0f) << 4) | (unit & 0x0f), cmd2 & 0xff, ...data];
  if (body.length > 255) throw new Error('VDCP zpráva je příliš dlouhá');
  return Buffer.from([STX, body.length, ...body, checksum(body)]);
}

export function describeNak(code) {
  const names = NAK_BITS.filter(([bit]) => code & bit).map(([, n]) => n);
  return names.length ? names.join(', ') : `kód 0x${hex(code)}`;
}

export function hex(n) {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

export function hexDump(buf) {
  return [...buf].map(hex).join(' ');
}

// --- ID klipů -------------------------------------------------------------

// Pevné ID: 8 bajtů ASCII doplněných mezerami. Delší ID se posílá
// variantou s proměnnou délkou (typ 8/A/B): bajt délky + znaky.
export function encodeId(id) {
  const s = String(id);
  if (!/^[\x20-\x7e]+$/.test(s)) throw new Error(`Neplatné ID klipu: ${s}`);
  if (s.length <= 8) {
    return { variable: false, bytes: [...Buffer.from(s.padEnd(8, ' '), 'ascii')] };
  }
  if (s.length > 200) throw new Error('ID klipu je příliš dlouhé');
  return { variable: true, bytes: [s.length, ...Buffer.from(s, 'ascii')] };
}

export function decodeFixedId(bytes) {
  return Buffer.from(bytes).toString('ascii').replace(/[\x00\s]+$/, '');
}

// --- Timecode (BCD, pořadí: snímky, sekundy, minuty, hodiny) ---------------

export function toBcd(n) {
  return ((Math.floor(n / 10) % 10) << 4) | (n % 10);
}

export function fromBcd(b) {
  return ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
}

export function encodeTimecode({ h = 0, m = 0, s = 0, f = 0 }) {
  return [toBcd(f), toBcd(s), toBcd(m), toBcd(h)];
}

export function decodeTimecode(bytes) {
  const [f, s, m, h] = bytes;
  // bit 7 snímkového bajtu = pole (50p), bit 6 = drop-frame
  return { h: fromBcd(h & 0x3f), m: fromBcd(m & 0x7f), s: fromBcd(s & 0x7f), f: fromBcd(f & 0x3f) };
}

export function formatTimecode(tc) {
  if (!tc) return '--:--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(tc.h)}:${p(tc.m)}:${p(tc.s)}:${p(tc.f)}`;
}

// --- Parser proudu bajtů -------------------------------------------------

// Vydává události 'ack', 'nak' (kód), 'message' ({type, unit, cmd2, data, raw}),
// 'garbage' (bajt, který nezapadá do rámce).
export class VdcpParser extends EventEmitter {
  constructor({ acceptAckNak = true } = {}) {
    super();
    this.buf = Buffer.alloc(0);
    this.acceptAckNak = acceptAckNak;
  }

  reset() {
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length === 0) return;
      const first = this.buf[0];
      if (this.acceptAckNak && first === ACK) {
        this.buf = this.buf.subarray(1);
        this.emit('ack');
        continue;
      }
      if (this.acceptAckNak && first === NAK) {
        if (this.buf.length < 2) return;
        const code = this.buf[1];
        this.buf = this.buf.subarray(2);
        this.emit('nak', code);
        continue;
      }
      if (first === STX) {
        if (this.buf.length < 2) return;
        const bc = this.buf[1];
        if (bc < 2) {
          this.emit('garbage', first);
          this.buf = this.buf.subarray(1);
          continue;
        }
        const total = bc + 3;
        if (this.buf.length < total) return;
        const raw = Buffer.from(this.buf.subarray(0, total));
        const body = raw.subarray(2, 2 + bc);
        const cs = raw[total - 1];
        this.buf = this.buf.subarray(total);
        if (checksum(body) !== cs) {
          this.emit('badchecksum', raw);
          continue;
        }
        this.emit('message', {
          type: body[0] >> 4,
          unit: body[0] & 0x0f,
          cmd2: body[1],
          data: Buffer.from(body.subarray(2)),
          raw,
        });
        continue;
      }
      this.emit('garbage', first);
      this.buf = this.buf.subarray(1);
    }
  }
}
