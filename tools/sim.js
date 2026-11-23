// Samostatný simulátor XT3 (VDCP zařízení).
//   npm run sim -- --tcp 9000          simulátor na TCP portu 9000 (PGM), 9001 (PRV)
//   npm run sim -- --serial COM7       simulátor na COM portu (např. virtuální pár com0com)
// Program pak připojíš v nastavení přes "TCP" nebo "RS-422".

import net from 'node:net';
import { Xt3Simulator } from '../src/sim/xt3-sim.js';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const sim = new Xt3Simulator();
sim.on('change', (ch, p) => console.log(`[${ch}] ${p.state} ${p.clipId ?? ''}`));
console.log(`Simulátor XT3: ${sim.clips.size} klipů.`);

const tcp = arg('--tcp');
const serial = arg('--serial');

if (tcp) {
  const base = Number(tcp);
  ['PGM', 'PRV'].forEach((channel, i) => {
    net.createServer((sock) => {
      console.log(`[${channel}] klient připojen`);
      const port = sim.attach(channel, (buf) => sock.write(buf));
      sock.on('data', (d) => port.receive(d));
      sock.on('close', () => port.detach());
      sock.on('error', () => {});
    }).listen(base + i, '127.0.0.1', () => console.log(`[${channel}] TCP 127.0.0.1:${base + i}`));
  });
} else if (serial) {
  const { SerialPort } = await import('serialport');
  const sp = new SerialPort({ path: serial, baudRate: 38400, parity: 'odd', dataBits: 8, stopBits: 1 });
  const port = sim.attach('PGM', (buf) => sp.write(buf));
  sp.on('data', (d) => port.receive(d));
  console.log(`[PGM] na ${serial}`);
} else {
  console.log('Použití: npm run sim -- --tcp 9000   nebo   npm run sim -- --serial COM7');
  process.exit(1);
}
