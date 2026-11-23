// Logika aplikace: připojení k EVS, seznam klipů, spuštění klipu, stav kanálu.

import { EventEmitter } from 'node:events';
import { VdcpClient } from './vdcp/client.js';
import { formatTimecode } from './vdcp/frame.js';
import { createTransport } from './transport/index.js';
import { parseLsmId } from './evs-id.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Controller extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.channels = {}; // { PGM: {transport, client}, PRV: {...} }
    this.clips = [];
    this.armed = false;
    this.busy = false;
    this.connection = 'odpojeno';
    this.lastError = null;
    this.status = {};
    this.logLines = [];
    this.pollTimer = null;
    this.statusSupported = true;
  }

  log(entry) {
    const line = { t: Date.now(), ...entry };
    this.logLines.push(line);
    if (this.logLines.length > 500) this.logLines.shift();
    this.emit('log', line);
  }

  info(text) {
    this.log({ channel: 'APP', dir: 'info', text });
  }

  snapshot() {
    return {
      connection: this.connection,
      lastError: this.lastError,
      armed: this.armed,
      busy: this.busy,
      takeMode: this.config.takeMode,
      transport: this.config.transport,
      status: this.status,
      clipCount: this.clips.length,
    };
  }

  pushState() {
    this.emit('state', this.snapshot());
  }

  setArmed(v) {
    this.armed = !!v;
    this.info(this.armed ? 'Program ODJIŠTĚN – klik na klip ho pustí do výstupu.' : 'Program zajištěn.');
    this.pushState();
  }

  async connect() {
    await this.disconnect();
    this.connection = 'připojuji';
    this.lastError = null;
    this.statusSupported = true;
    this.pushState();
    const names = this.config.takeMode === 'prv' ? ['PGM', 'PRV'] : ['PGM'];
    try {
      for (const name of names) {
        const chCfg = this.config[name.toLowerCase()];
        const transport = createTransport({ transport: this.config.transport, ...chCfg }, name);
        transport.on('error', (e) => this.fail(`${name}: ${e.message}`));
        await transport.open();
        const client = new VdcpClient(transport, {
          name,
          unit: chCfg.unit,
          timeoutMs: this.config.timeoutMs,
          statusBitmap: this.config.statusBitmap,
        });
        client.on('log', (l) => this.log(l));
        this.channels[name] = { transport, client };
      }
      this.connection = 'připojeno';
      this.info(`Připojeno (${this.config.transport}, režim ${this.config.takeMode}).`);
      this.pushState();
      await this.refreshClips();
      this.startPolling();
    } catch (e) {
      this.fail(e.message);
    }
  }

  fail(msg) {
    this.lastError = msg;
    this.connection = 'chyba';
    this.info(`Chyba: ${msg}`);
    this.pushState();
  }

  async disconnect() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const { transport, client } of Object.values(this.channels)) {
      client.dispose();
      await transport.close().catch(() => {});
    }
    this.channels = {};
    this.connection = 'odpojeno';
    this.pushState();
  }

  get pgm() {
    return this.channels.PGM?.client;
  }

  async refreshClips() {
    if (!this.pgm) throw new Error('Není připojeno.');
    const ids = await this.pgm.idList();
    this.clips = ids.map((id) => ({ id, lsm: parseLsmId(id), duration: null }));
    this.info(`Načteno ${this.clips.length} klipů.`);
    this.emit('clips', this.clips);
    this.pushState();
    this.loadDurations(); // na pozadí
  }

  async loadDurations() {
    for (const clip of this.clips) {
      if (!this.pgm) return;
      try {
        const tc = await this.pgm.idSize(clip.id);
        clip.duration = tc ? formatTimecode(tc) : null;
      } catch {
        return; // server ID SIZE nepodporuje, nevadí
      }
    }
    this.emit('clips', this.clips);
  }

  startPolling() {
    clearInterval(this.pollTimer);
    let running = false;
    this.pollTimer = setInterval(async () => {
      if (running || this.busy || !this.pgm) return;
      running = true;
      try {
        await this.pollOnce();
      } finally {
        running = false;
      }
    }, this.config.pollMs);
  }

  async pollOnce() {
    const out = {};
    for (const [name, { client }] of Object.entries(this.channels)) {
      const s = { };
      try {
        if (this.statusSupported) {
          const st = await client.portStatus();
          Object.assign(s, st);
        }
      } catch (e) {
        if (e.code !== undefined) this.statusSupported = false;
        s.error = e.message;
      }
      try {
        s.position = formatTimecode(await client.position(1));
      } catch (e) {
        s.error ??= e.message;
      }
      try {
        const a = await client.activeId();
        s.activeId = a.id;
      } catch (e) {
        s.error ??= e.message;
      }
      out[name] = s;
    }
    this.status = out;
    if (this.connection === 'chyba' && !Object.values(out).some((s) => s.error)) {
      this.connection = 'připojeno';
      this.lastError = null;
    }
    this.pushState();
  }

  /** Klik na klip: načíst (cue) a pustit. */
  async take(id) {
    if (!this.armed) throw new Error('Program je zajištěný. Nejdřív ho odjisti.');
    if (this.busy) throw new Error('Probíhá předchozí příkaz.');
    const chName = this.config.takeMode === 'prv' ? 'PRV' : 'PGM';
    const ch = this.channels[chName]?.client;
    if (!ch) throw new Error(`Kanál ${chName} není připojený.`);
    this.busy = true;
    this.pushState();
    const t0 = Date.now();
    try {
      await ch.cue(id);
      const cueOk = await this.waitCueDone(ch);
      await ch.play();
      const ms = Date.now() - t0;
      this.info(`TAKE ${id} na ${chName}: ${ms} ms${cueOk ? '' : ' (bez potvrzení cue, čekáno pevně)'}.`);
      return { id, channel: chName, ms, cueConfirmed: cueOk };
    } finally {
      this.busy = false;
      this.pushState();
    }
  }

  async waitCueDone(ch) {
    const deadline = Date.now() + this.config.cueTimeoutMs;
    if (this.statusSupported) {
      while (Date.now() < deadline) {
        try {
          const st = await ch.portStatus();
          if (st.cueDone) return true;
        } catch {
          break;
        }
        await sleep(30);
      }
    }
    await sleep(this.config.cueFallbackMs);
    return false;
  }

  async transport(cmd) {
    const ch = this.pgm;
    if (!ch) throw new Error('Není připojeno.');
    if (cmd === 'still') return ch.still();
    if (cmd === 'continue') return ch.continue();
    if (cmd === 'stop') {
      if (!this.armed) throw new Error('Program je zajištěný.');
      return ch.stop();
    }
    throw new Error(`Neznámý příkaz ${cmd}`);
  }
}
