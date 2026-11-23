// Pasivní odposlech RS-422 linky mezi LSM ovladačem a serverem XT3.
// Převodníky se připojují JEN přijímacími vodiči (RX), nic na linku nevysílají.
// Viz docs/zapojeni-rs422.md.
//
//   npm run sniff -- --a COM5 --b COM6
//   npm run sniff -- --a COM5 --b COM6 --baud 38400 --parity odd
//
//   --a       převodník, který poslouchá směr OVLADAČ → SERVER
//   --b       převodník, který poslouchá směr SERVER → OVLADAČ (volitelné)
//   --baud    rychlost (výchozí 38400)
//   --parity  none | odd | even (výchozí odd)
//   --gap     ms ticha, po kterých začne nový řádek (výchozí 4)
//
// Záznam se ukládá do logs/sniff-<datum>.txt. Během nahrávání dělej na ovladači
// vždy jednu akci a zapiš si ji: v konzoli napiš poznámku a dej Enter, uloží se
// do záznamu (např. "recall 111A na PRV", "take s mixem 1 s").

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const opts = {
  baudRate: Number(arg('--baud', 38400)),
  parity: arg('--parity', 'odd'),
  dataBits: Number(arg('--bits', 8)),
  stopBits: 1,
};
const gapMs = Number(arg('--gap', 4));
const ports = [
  ['OVL→SRV', arg('--a')],
  ['SRV→OVL', arg('--b')],
].filter(([, p]) => p);

if (!ports.length) {
  console.log('Použití: npm run sniff -- --a COM5 [--b COM6] [--baud 38400] [--parity odd]');
  process.exit(1);
}

const { SerialPort } = await import('serialport');
fs.mkdirSync('logs', { recursive: true });
const file = path.join('logs', `sniff-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
const out = fs.createWriteStream(file, { flags: 'a' });
const write = (line) => {
  console.log(line);
  out.write(line + '\n');
};
write(`# Záznam ${new Date().toLocaleString('cs-CZ')} – ${opts.baudRate} Bd, parita ${opts.parity}, ${opts.dataBits} bitů`);

const ts = () => {
  const d = new Date();
  return d.toLocaleTimeString('cs-CZ', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
};

for (const [label, p] of ports) {
  const sp = new SerialPort({ path: p, ...opts });
  let buf = [];
  let timer = null;
  const flush = () => {
    if (!buf.length) return;
    const hexs = buf.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const ascii = buf.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    write(`${ts()} ${label} [${String(buf.length).padStart(3)}] ${hexs}   |${ascii}|`);
    buf = [];
  };
  sp.on('data', (d) => {
    buf.push(...d);
    clearTimeout(timer);
    timer = setTimeout(flush, gapMs);
  });
  sp.on('error', (e) => write(`# ${label} chyba: ${e.message}`));
  sp.on('open', () => write(`# ${label} poslouchá na ${p}`));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => line.trim() && write(`${ts()} POZNÁMKA: ${line.trim()}`));
console.log(`Ukládám do ${file}. Poznámku napiš a dej Enter. Konec: Ctrl+C.`);
