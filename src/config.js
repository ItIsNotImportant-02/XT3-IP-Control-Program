import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  // Jak se program připojí k serveru: "sim" (simulátor), "serial" (COM port), "tcp"
  transport: 'sim',
  // Režim spuštění klipu:
  //   "cut" – načte klip na kanál PGM a hned ho pustí (střih)
  //   "prv" – načte klip na kanál PRV a pustí ho tam (test prolínačky EVS PGM/PRV)
  takeMode: 'cut',
  pgm: { path: '', baudRate: 38400, parity: 'odd', host: '127.0.0.1', tcpPort: 9000, unit: 0 },
  prv: { path: '', baudRate: 38400, parity: 'odd', host: '127.0.0.1', tcpPort: 9001, unit: 0 },
  timeoutMs: 150,
  pollMs: 250,
  cueTimeoutMs: 2000,
  // Když server neumí hlásit "cue hotovo", počká se tolik ms a pak se dá PLAY
  cueFallbackMs: 400,
  statusBitmap: 1,
  httpPort: 8080,
});

export function loadConfig(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

export function mergeConfig(base, patch) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in base)) continue;
    if (base[k] && typeof base[k] === 'object') out[k] = { ...base[k], ...pick(base[k], v) };
    else if (typeof v === typeof base[k]) out[k] = v;
  }
  return out;
}

function pick(base, v) {
  const out = {};
  for (const [k, val] of Object.entries(v ?? {})) {
    if (k in base && typeof val === typeof base[k]) out[k] = val;
  }
  return out;
}
