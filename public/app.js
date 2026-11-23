// Uživatelské rozhraní XT3 Control.

const $ = (s) => document.querySelector(s);
const state = { clips: [], page: null, snapshot: {}, config: null };

// --- API ------------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer;
function toast(text, err = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast${err ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 4000 : 1800);
}

async function act(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Živé události ---------------------------------------------------------

const events = new EventSource('/api/events');
events.addEventListener('state', (e) => {
  state.snapshot = JSON.parse(e.data);
  renderStatus();
  updateHighlights();
});
events.addEventListener('clips', (e) => {
  state.clips = JSON.parse(e.data);
  renderPages();
  renderGrid();
});
events.addEventListener('log', (e) => appendLog(JSON.parse(e.data)));

// --- Stav ------------------------------------------------------------------

function channelState(s) {
  if (!s) return '–';
  if (s.error) return 'chyba';
  if (s.playing) return 'PLAY';
  if (s.still) return 'STILL';
  if (s.cueDone) return 'připraveno';
  if (s.cueing) return 'načítám…';
  if (s.idle) return 'idle';
  return '–';
}

function renderStatus() {
  const s = state.snapshot;
  const conn = $('#conn');
  conn.textContent = s.connection + (s.transport === 'sim' ? ' (simulátor)' : '');
  conn.className = `pill${s.connection === 'připojeno' ? ' ok' : s.connection === 'chyba' ? ' err' : ''}`;
  conn.title = s.lastError || 'Stav připojení';
  const ch = s.status?.[s.takeMode === 'prv' ? 'PRV' : 'PGM'] ?? s.status?.PGM;
  $('#st-state').textContent = channelState(ch);
  $('#st-clip').textContent = ch?.activeId || '–';
  $('#st-tc').textContent = ch?.position || '--:--:--:--';
  const arm = $('#btn-arm');
  arm.textContent = s.armed ? 'ODJIŠTĚNO' : 'ZAJIŠTĚNO';
  arm.classList.toggle('on', !!s.armed);
  $('#mode-label').textContent = s.takeMode === 'prv'
    ? 'Režim: test PGM/PRV (klip na PRV)'
    : 'Režim: střih (klip na PGM)';
}

// --- Stránky a mřížka -------------------------------------------------------

function pagesOf(clips) {
  return [...new Set(clips.filter((c) => c.lsm).map((c) => c.lsm.page))].sort((a, b) => a - b);
}

function renderPages() {
  const pages = pagesOf(state.clips);
  if (!pages.includes(state.page)) state.page = pages[0] ?? null;
  const nav = $('#pages');
  nav.replaceChildren(...pages.map((p) => {
    const b = document.createElement('button');
    b.textContent = `Page ${p}`;
    b.classList.toggle('active', p === state.page);
    b.onclick = () => { state.page = p; renderPages(); renderGrid(); };
    return b;
  }));
}

function camClass(id) {
  const s = state.snapshot;
  const ch = s.status?.[s.takeMode === 'prv' ? 'PRV' : 'PGM'] ?? s.status?.PGM;
  if (!ch || ch.activeId !== id) return '';
  if (ch.playing) return 'playing';
  if (ch.still) return 'still';
  if (ch.cueing || ch.cueDone) return 'cueing';
  return '';
}

function camButton(clip, text) {
  const b = document.createElement('button');
  b.className = `cam ${camClass(clip.id)}`;
  b.dataset.id = clip.id;
  b.title = `${clip.id}${clip.duration ? ` · ${clip.duration}` : ''}`;
  const l = document.createElement('span');
  l.className = 'letter';
  l.textContent = text;
  const d = document.createElement('span');
  d.className = 'dur';
  d.textContent = clip.duration ? clip.duration.slice(3, 8) : '';
  b.append(l, d);
  b.onclick = () => take(clip.id);
  return b;
}

function renderGrid() {
  const grid = $('#grid');
  const lsm = state.clips.filter((c) => c.lsm && c.lsm.page === state.page);
  const other = state.clips.filter((c) => !c.lsm);
  $('#empty').hidden = state.clips.length > 0;

  const banks = Math.max(0, ...lsm.map((c) => c.lsm.bank));
  const cells = [];
  if (lsm.length) {
    cells.push(div('head', ''));
    for (let p = 1; p <= 10; p++) cells.push(div('head', `F${p}`));
    for (let bank = 1; bank <= banks; bank++) {
      cells.push(div('rowhead', `Bank ${bank}`));
      for (let pos = 1; pos <= 10; pos++) {
        const here = lsm.filter((c) => c.lsm.bank === bank && c.lsm.position === pos)
          .sort((a, b) => a.lsm.cam.localeCompare(b.lsm.cam));
        const cell = div(`cell${here.length ? '' : ' empty-cell'}`);
        cell.append(div('label', `${state.page}${bank % 10}${pos % 10}`));
        const cams = div('cams');
        cams.append(...here.map((c) => camButton(c, c.lsm.cam)));
        cell.append(cams);
        cells.push(cell);
      }
    }
  }
  grid.replaceChildren(...cells);

  $('#other-wrap').hidden = other.length === 0;
  $('#other').replaceChildren(...other.map((c) => camButton(c, c.id)));
}

// Při změně stavu se jen přebarví tlačítka (mřížka se nepřekresluje,
// aby se neztratil rozkliknutý klik).
function updateHighlights() {
  document.querySelectorAll('.cam[data-id]').forEach((b) => {
    const cls = camClass(b.dataset.id);
    b.classList.remove('playing', 'still', 'cueing');
    if (cls) b.classList.add(cls);
  });
}

function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

// --- Akce ------------------------------------------------------------------

async function take(id) {
  if (!state.snapshot.armed) {
    toast(`Zajištěno: ${id} se nespustí. Odjisti tlačítkem vpravo nahoře.`);
    return;
  }
  const r = await act(() => api('/api/take', { id }));
  if (r) toast(`▶ ${id}  (${r.ms} ms)`);
}

$('#btn-arm').onclick = () => act(() => api('/api/arm', { armed: !state.snapshot.armed }));
$('#btn-still').onclick = () => act(() => api('/api/transport', { cmd: 'still' }));
$('#btn-continue').onclick = () => act(() => api('/api/transport', { cmd: 'continue' }));
$('#btn-stop').onclick = () => {
  if (confirm('STOP dá do výstupu černou. Opravdu?')) act(() => api('/api/transport', { cmd: 'stop' }));
};
$('#btn-refresh').onclick = () => act(() => api('/api/refresh', {}));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('dialog')) return;
  const pages = pagesOf(state.clips);
  const i = pages.indexOf(state.page);
  if (e.key === 'PageDown' && i < pages.length - 1) state.page = pages[i + 1];
  else if (e.key === 'PageUp' && i > 0) state.page = pages[i - 1];
  else return;
  e.preventDefault();
  renderPages();
  renderGrid();
});

// --- Log -------------------------------------------------------------------

const logLines = [];
function appendLog(l) {
  const t = new Date(l.t).toLocaleTimeString('cs-CZ', { hour12: false }) + '.' + String(l.t % 1000).padStart(3, '0');
  logLines.push(`${t} ${l.channel.padEnd(3)} ${l.dir.padEnd(4)} ${l.text}`);
  if (logLines.length > 400) logLines.shift();
  if (!$('#log').hidden) renderLog();
}
function renderLog() {
  const body = $('#log-body');
  body.textContent = logLines.join('\n');
  body.scrollTop = body.scrollHeight;
}
$('#btn-log').onclick = () => { $('#log').hidden = !$('#log').hidden; renderLog(); };
$('#btn-log-close').onclick = () => { $('#log').hidden = true; };

// --- Nastavení -------------------------------------------------------------

const form = $('#settings-form');

async function fillPorts() {
  const ports = await act(() => api('/api/ports')) ?? [];
  for (const ch of ['pgm', 'prv']) {
    const sel = form.elements[`${ch}.path`];
    const current = state.config?.[ch]?.path ?? '';
    const opts = [['', '— vyber —'], ...ports.map((p) => [p.path, `${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ''}`])];
    if (current && !ports.some((p) => p.path === current)) opts.push([current, `${current} (nenalezen)`]);
    sel.replaceChildren(...opts.map(([v, t]) => new Option(t, v, false, v === current)));
  }
}

function syncVisibility() {
  const t = form.elements.transport.value;
  form.querySelectorAll('.serial').forEach((el) => { el.hidden = t !== 'serial'; });
  form.querySelectorAll('.tcp').forEach((el) => { el.hidden = t !== 'tcp'; });
  form.querySelector('[data-ch="prv"]').hidden = form.elements.takeMode.value !== 'prv' || t === 'sim';
  form.querySelector('[data-ch="pgm"]').hidden = t === 'sim';
}

$('#btn-settings').onclick = async () => {
  state.config = await act(() => api('/api/config'));
  if (!state.config) return;
  form.elements.transport.value = state.config.transport;
  form.elements.takeMode.value = state.config.takeMode;
  for (const ch of ['pgm', 'prv']) {
    form.elements[`${ch}.host`].value = state.config[ch].host;
    form.elements[`${ch}.tcpPort`].value = state.config[ch].tcpPort;
  }
  await fillPorts();
  syncVisibility();
  $('#settings').showModal();
};
form.elements.transport.onchange = syncVisibility;
form.elements.takeMode.onchange = syncVisibility;
$('#btn-ports').onclick = fillPorts;

$('#settings').addEventListener('close', async () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = form.elements;
  const ch = (n) => ({
    path: f[`${n}.path`].value,
    host: f[`${n}.host`].value,
    tcpPort: Number(f[`${n}.tcpPort`].value) || state.config[n].tcpPort,
  });
  await act(async () => {
    await api('/api/config', {
      transport: f.transport.value,
      takeMode: f.takeMode.value,
      pgm: ch('pgm'),
      prv: ch('prv'),
    });
    await api('/api/connect', {});
  });
});
