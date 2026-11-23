// Simulátor EVS XT3 jako VDCP zařízení. Slouží k vývoji a testům bez serveru.
// Chování odpovídá dokumentaci VDCP; skutečné EVS se může v detailech lišit.

import { EventEmitter } from 'node:events';
import {
  ACK, NAK, STX, TYPE, VdcpParser, checksum, decodeFixedId, encodeTimecode,
} from '../vdcp/frame.js';

const FPS = 25;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function generateClips(seed = 7) {
  const rand = rng(seed);
  const clips = new Map();
  for (let page = 1; page <= 3; page++) {
    for (let bank = 1; bank <= 6; bank++) {
      for (let pos = 1; pos <= 10; pos++) {
        if (rand() < 0.45) continue;
        const cams = 'ABCD'.slice(0, 1 + Math.floor(rand() * 4));
        for (const cam of cams) {
          const id = `${page}${bank}${pos % 10}${cam}`;
          clips.set(id, { durationFrames: FPS * (4 + Math.floor(rand() * 40)) });
        }
      }
    }
  }
  for (const id of ['PROMO01', 'INTRO', 'GOAL_HL']) {
    clips.set(id, { durationFrames: FPS * 20 });
  }
  return clips;
}

class Player {
  constructor() {
    this.state = 'idle';
    this.clipId = null;
    this.cueAt = 0;
    this.posFrames = 0;
    this.playStartedAt = 0;
    this.playStartedPos = 0;
  }
}

export class Xt3Simulator extends EventEmitter {
  constructor({ clips = generateClips(), cueDelayMs = 250 } = {}) {
    super();
    this.clips = clips;
    this.cueDelayMs = cueDelayMs;
    this.players = new Map();
  }

  player(channel) {
    if (!this.players.has(channel)) this.players.set(channel, new Player());
    return this.players.get(channel);
  }

  attach(channel, send) {
    const parser = new VdcpParser({ acceptAckNak: false });
    const listCursor = { ids: [], index: 0 };
    parser.on('message', (msg) => {
      const reply = this.handle(channel, msg, listCursor);
      if (reply) send(reply);
    });
    parser.on('badchecksum', () => send(Buffer.from([NAK, 0x08])));
    return {
      receive: (buf) => parser.push(buf),
      detach: () => parser.removeAllListeners(),
    };
  }

  _tick(p) {
    const now = Date.now();
    if (p.state === 'cueing' && now >= p.cueAt) p.state = 'cued';
    if (p.state === 'play') {
      const clip = this.clips.get(p.clipId);
      const pos = p.playStartedPos + Math.floor(((now - p.playStartedAt) / 1000) * FPS);
      if (clip && pos >= clip.durationFrames) {
        p.posFrames = clip.durationFrames - 1;
        p.state = 'still';
      } else {
        p.posFrames = pos;
      }
    }
  }

  handle(channel, msg, cursor) {
    const p = this.player(channel);
    this._tick(p);
    const key = `${msg.type}:${msg.cmd2}`;
    const ack = Buffer.from([ACK]);
    const nak = (code = 0x04) => Buffer.from([NAK, code]);

    switch (key) {
      case `${TYPE.SYSTEM}:${0x0c}`:
      case `${TYPE.SYSTEM}:${0x0d}`:
        return ack;
      case `${TYPE.IMMEDIATE}:${0x00}`: // STOP
        Object.assign(p, new Player());
        this.emit('change', channel, p);
        return ack;
      case `${TYPE.IMMEDIATE}:${0x01}`: // PLAY
        if (p.state === 'cued' || p.state === 'still') {
          p.state = 'play';
          p.playStartedAt = Date.now();
          p.playStartedPos = p.posFrames;
          this.emit('change', channel, p);
        }
        return ack;
      case `${TYPE.IMMEDIATE}:${0x04}`: // STILL
        if (p.state === 'play') p.state = 'still';
        this.emit('change', channel, p);
        return ack;
      case `${TYPE.IMMEDIATE}:${0x06}`: // CONTINUE
        if (p.state === 'still') {
          p.state = 'play';
          p.playStartedAt = Date.now();
          p.playStartedPos = p.posFrames;
        }
        this.emit('change', channel, p);
        return ack;
      case `${TYPE.PRESET}:${0x22}`: // SELECT PORT
        return ack;
      case `${TYPE.PRESET}:${0x24}`: // PLAY CUE
      case `${TYPE.VAR_PRESET}:${0x24}`: {
        const id = msg.type === TYPE.VAR_PRESET
          ? msg.data.subarray(1, 1 + msg.data[0]).toString('ascii')
          : decodeFixedId(msg.data.subarray(0, 8));
        if (!this.clips.has(id)) return ack; // VDCP: ACK, chyba se hlásí ve statusu
        p.clipId = id;
        p.state = 'cueing';
        p.cueAt = Date.now() + this.cueDelayMs;
        p.posFrames = 0;
        this.emit('change', channel, p);
        return ack;
      }
      case `${TYPE.SENSE}:${0x01}`: // OPEN PORT
        return frame(0x30, 0x81, [1]);
      case `${TYPE.SENSE}:${0x05}`: { // PORT STATUS
        const s1 = (p.state === 'idle' ? 0x01 : 0)
          | (p.state === 'cueing' ? 0x02 : 0)
          | (p.state === 'play' ? 0x04 : 0)
          | (p.state === 'still' ? 0x08 : 0)
          | (p.state === 'cued' ? 0x80 : 0);
        return frame(0x30, 0x85, [msg.data[0] ?? 0x01, s1]);
      }
      case `${TYPE.SENSE}:${0x06}`: { // POSITION
        const f = p.posFrames;
        const tc = {
          h: Math.floor(f / (FPS * 3600)),
          m: Math.floor(f / (FPS * 60)) % 60,
          s: Math.floor(f / FPS) % 60,
          f: f % FPS,
        };
        return frame(0x30, 0x86, [msg.data[0] ?? 1, ...encodeTimecode(tc)]);
      }
      case `${TYPE.SENSE}:${0x07}`: { // ACTIVE ID
        const id = (p.clipId ?? '').padEnd(8, ' ').slice(0, 8);
        return frame(0x30, 0x87, [p.clipId ? 1 : 0, ...Buffer.from(id, 'ascii')]);
      }
      case `${TYPE.SENSE}:${0x08}`:
        return frame(0x30, 0x88, [...Buffer.from('XT3-SIM ', 'ascii')]);
      case `${TYPE.SENSE}:${0x11}`: // ID LIST
        cursor.ids = [...this.clips.keys()];
        cursor.index = 0;
        return this._listBatch(cursor, 0x91);
      case `${TYPE.SENSE}:${0x02}`: // NEXT
        return this._listBatch(cursor, 0x82);
      case `${TYPE.SENSE}:${0x14}`: { // ID SIZE
        const id = decodeFixedId(msg.data.subarray(0, 8));
        const clip = this.clips.get(id);
        if (!clip) return frame(0x30, 0x94, encodeTimecode({}));
        const f = clip.durationFrames;
        return frame(0x30, 0x94, encodeTimecode({
          h: 0, m: Math.floor(f / (FPS * 60)) % 60, s: Math.floor(f / FPS) % 60, f: f % FPS,
        }));
      }
      default:
        return nak(0x04);
    }
  }

  _listBatch(cursor, cmd2) {
    const batch = cursor.ids.slice(cursor.index, cursor.index + 10);
    cursor.index += batch.length;
    const remaining = cursor.ids.length - cursor.index;
    const data = [remaining >> 8, remaining & 0xff];
    for (const id of batch) data.push(...Buffer.from(id.padEnd(8, ' ').slice(0, 8), 'ascii'));
    return frame(0x30, cmd2, data);
  }
}

function frame(cmd1, cmd2, data) {
  const body = [cmd1, cmd2, ...data];
  return Buffer.from([STX, body.length, ...body, checksum(body)]);
}
