// XT3 Control – lokální server. Spusť `npm start` a otevři http://localhost:8080
// Rozhraní běží v prohlížeči, komunikace s EVS jde přes tento proces.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Controller } from './controller.js';
import { loadConfig, saveConfig, mergeConfig } from './config.js';
import { listSerialPorts } from './transport/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createApp({ config = loadConfig(CONFIG_FILE), persist = true } = {}) {
  const ctl = new Controller(config);
  const clients = new Set();

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  ctl.on('state', (s) => broadcast('state', s));
  ctl.on('clips', (c) => broadcast('clips', c));
  ctl.on('log', (l) => broadcast('log', l));

  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

  const routes = {
    'GET /api/events': (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: state\ndata: ${JSON.stringify(ctl.snapshot())}\n\n`);
      res.write(`event: clips\ndata: ${JSON.stringify(ctl.clips)}\n\n`);
      for (const l of ctl.logLines.slice(-100)) res.write(`event: log\ndata: ${JSON.stringify(l)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    'GET /api/config': (req, res) => json(res, 200, ctl.config),
    'POST /api/config': async (req, res) => {
      const body = await readBody(req);
      ctl.config = mergeConfig(ctl.config, body);
      if (persist) saveConfig(CONFIG_FILE, ctl.config);
      await ctl.disconnect();
      json(res, 200, ctl.config);
    },
    'GET /api/ports': async (req, res) => json(res, 200, await listSerialPorts()),
    'POST /api/connect': async (req, res) => {
      await ctl.connect();
      json(res, 200, ctl.snapshot());
    },
    'POST /api/disconnect': async (req, res) => {
      await ctl.disconnect();
      json(res, 200, ctl.snapshot());
    },
    'POST /api/refresh': async (req, res) => {
      await ctl.refreshClips();
      json(res, 200, { count: ctl.clips.length });
    },
    'POST /api/arm': async (req, res) => {
      const body = await readBody(req);
      ctl.setArmed(body.armed);
      json(res, 200, ctl.snapshot());
    },
    'POST /api/take': async (req, res) => {
      const body = await readBody(req);
      json(res, 200, await ctl.take(String(body.id ?? '')));
    },
    'POST /api/transport': async (req, res) => {
      const body = await readBody(req);
      await ctl.transport(String(body.cmd));
      json(res, 200, { ok: true });
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (route) return await route(req, res);
      if (req.method !== 'GET') return json(res, 404, { error: 'nenalezeno' });
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.resolve(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('Nenalezeno');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: e.message });
    }
  });

  return { server, ctl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, ctl } = createApp();
  const port = ctl.config.httpPort;
  // Jen na tomto počítači, ne do sítě.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`XT3 Control běží na ${url}  (ukončení: Ctrl+C)`);
    if (process.platform === 'win32' && !process.argv.includes('--no-open')) exec(`start "" ${url}`);
    ctl.connect();
  });
  const shutdown = async () => {
    await ctl.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
