import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage, checksum, VdcpParser, encodeId, encodeTimecode, decodeTimecode, TYPE,
} from '../src/vdcp/frame.js';
import { parseIdListReply, VdcpClient } from '../src/vdcp/client.js';
import { parseLsmId } from '../src/evs-id.js';

test('PLAY odpovídá příkladu z dokumentace VDCP: 02 02 10 01 EF', () => {
  assert.deepEqual([...buildMessage(TYPE.IMMEDIATE, 0, 0x01)], [0x02, 0x02, 0x10, 0x01, 0xef]);
});

test('PLAY CUE s 8znakovým ID má BC 0A a 13 bajtů', () => {
  const m = buildMessage(TYPE.PRESET, 0, 0x24, encodeId('111A').bytes);
  assert.equal(m[1], 0x0a);
  assert.equal(m.length, 13);
  assert.equal(checksum(m.subarray(2, 12)), m[12]);
});

test('dlouhé ID jde variantou s proměnnou délkou', () => {
  const r = encodeId('VERY_LONG_CLIP');
  assert.equal(r.variable, true);
  assert.equal(r.bytes[0], 14);
});

test('parser rozpozná ACK, NAK a zprávu i po kouscích', () => {
  const p = new VdcpParser();
  const got = [];
  p.on('ack', () => got.push('ack'));
  p.on('nak', (c) => got.push(`nak:${c}`));
  p.on('message', (m) => got.push(`msg:${m.cmd2.toString(16)}:${[...m.data]}`));
  const msg = buildMessage(3, 0, 0x85, [1, 0x80]);
  p.push(Buffer.from([0x04, 0x05]));
  p.push(Buffer.from([0x08, ...msg.subarray(0, 3)]));
  p.push(msg.subarray(3));
  assert.deepEqual(got, ['ack', 'nak:8', 'msg:85:1,128']);
});

test('parser zahodí zprávu se špatným checksumem', () => {
  const p = new VdcpParser();
  let bad = 0;
  let ok = 0;
  p.on('badchecksum', () => bad++);
  p.on('message', () => ok++);
  const m = buildMessage(1, 0, 1);
  m[m.length - 1] ^= 0xff;
  p.push(m);
  assert.equal(bad, 1);
  assert.equal(ok, 0);
});

test('timecode BCD tam a zpět (snímky první)', () => {
  const bytes = encodeTimecode({ h: 1, m: 2, s: 35, f: 22 });
  assert.deepEqual(bytes, [0x22, 0x35, 0x02, 0x01]);
  assert.deepEqual(decodeTimecode(bytes), { h: 1, m: 2, s: 35, f: 22 });
});

test('odpověď ID LIST s počtem i bez počtu', () => {
  const ids = Buffer.from('111A    112B    ', 'ascii');
  assert.deepEqual(parseIdListReply(Buffer.concat([Buffer.from([0, 5]), ids])), { ids: ['111A', '112B'], remaining: 5 });
  assert.deepEqual(parseIdListReply(ids).ids, ['111A', '112B']);
});

test('LSM ID se rozloží na stránku, banku, pozici, kameru', () => {
  assert.deepEqual(parseLsmId('230C/02'), { id: '230C/02', page: 2, bank: 3, position: 10, cam: 'C', server: 2 });
  assert.equal(parseLsmId('PROMO01'), null);
});

test('klient odmítne příkazy mimo povolený seznam (RECORD, DELETE)', async () => {
  const fake = { on() {}, write() { throw new Error('nemělo se nic poslat'); } };
  const c = new VdcpClient(fake);
  await assert.rejects(c.send(TYPE.IMMEDIATE, 0x02), /není povolen/); // RECORD
  await assert.rejects(c.send(TYPE.PRESET, 0x26, []), /není povolen/); // DELETE ID
  await assert.rejects(c.send(TYPE.PRESET, 0x23, []), /není povolen/); // RECORD INIT
});
