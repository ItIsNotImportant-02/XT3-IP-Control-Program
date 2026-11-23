import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/controller.js';
import { DEFAULT_CONFIG } from '../src/config.js';

test('se simulátorem: připojení, seznam klipů, klik = cue + play', async () => {
  const ctl = new Controller(structuredClone({ ...DEFAULT_CONFIG, pollMs: 50 }));
  await ctl.connect();
  try {
    assert.equal(ctl.connection, 'připojeno');
    assert.ok(ctl.clips.length > 20, 'načteny klipy');
    const clip = ctl.clips.find((c) => c.lsm);
    await assert.rejects(ctl.take(clip.id), /zajištěný/);
    ctl.setArmed(true);
    const r = await ctl.take(clip.id);
    assert.equal(r.cueConfirmed, true);
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(ctl.status.PGM.activeId, clip.id);
    assert.equal(ctl.status.PGM.playing, true);
    await ctl.transport('still');
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(ctl.status.PGM.still, true);
  } finally {
    await ctl.disconnect();
  }
});
