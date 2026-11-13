'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../jitter.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('tests/cases.json: hand-checked expectations hold', () => {
  const cases = JSON.parse(read('tests/cases.json'));
  assert.ok(cases.length >= 8);
  for (const c of cases) {
    const r = G.run(c.input);
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(r[k], v, `${c.name}: ${k}`);
  }
});

test('percentile is nearest rank', () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(G.percentile(s, 95), 95); assert.equal(G.percentile(s, 99), 99); assert.equal(G.percentile([5], 99), 5);
});

test('jitter is not bridged across a lost packet', () => {
  const r = G.analyze([10, null, 50, 52]);
  assert.equal(r.jitter_ms, 2);                       // only the (50,52) pair
});

test('verdict thresholds: edges', () => {
  const steady = n => Array.from({ length: n }, (_, i) => 20 + (i % 2) * 2);
  assert.equal(G.analyze(steady(30)).verdict, 'good');
  const s = steady(199); s.push(null);                 // 1 of 200 lost = 0.5% -> still good
  assert.equal(G.analyze(s).loss_pct, 0.5); assert.equal(G.analyze(s).verdict, 'good');
  const t = steady(98); t.push(null, null);            // 2 of 100 = 2% -> bad
  assert.equal(G.analyze(t).verdict, 'bad');
  const u = steady(97); u.push(null, null, null);      // 3% bad
  assert.equal(G.analyze(u).verdict, 'bad');
});

test('few samples add a note; no samples throws', () => {
  assert.ok(G.run('10 11 12').notes.some(n => /not meaningful/.test(n)));
  assert.throws(() => G.run('hello world'), /no ping samples recognised/);
  assert.throws(() => G.analyze([]), /no samples/);
});

test('saved ping sample: JS result equals the CLI result saved by game_jitter.py --json', () => {
  const saved = JSON.parse(read('examples/sample-result.json'));
  const r = G.run(read('examples/sample-ping.txt'));
  delete r.samples;
  assert.deepEqual(r, saved);
});

test('saved ping sample: JS report equals the CLI text saved in examples/', () => {
  assert.equal(G.report(G.run(read('examples/sample-ping.txt'))) + '\n', read('examples/sample-output.txt'));
  assert.equal(G.report(G.run(read('examples/sample-mtr.txt'))) + '\n', read('examples/sample-mtr-output.txt'));
});

test('the sample is a real ping run: summary line agrees with the parsed samples', () => {
  const t = read('examples/sample-ping.txt');
  const m = /(\d+) packets transmitted, (\d+) received/.exec(t);
  const r = G.run(t);
  assert.equal(r.total, +m[1]); assert.equal(r.received, +m[2]);
  assert.equal(t.split('\n').filter(l => /icmp_seq=\d+ .*time=/.test(l)).length, +m[2]);
  const mm = /min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(t);
  assert.ok(Math.abs(r.min_ms - +mm[1]) < 0.01 && Math.abs(r.max_ms - +mm[3]) < 0.01 && Math.abs(r.mean_ms - +mm[2]) < 0.01);   // ping's own min/avg/max
});
