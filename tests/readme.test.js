'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const G = require('../jitter.js');

test('README has a runnable quickstart and quotes the saved CLI output', () => {
  const rd = read('README.md');
  assert.ok(rd.includes('python -m http.server') && rd.includes('node --test tests/'));
  const sample = read('examples/sample-output.txt').trimEnd();
  assert.ok(rd.includes(sample), 'README must contain examples/sample-output.txt verbatim');
  const mtr = read('examples/sample-mtr-output.txt').split('\n').slice(0, 9).join('\n');
  assert.ok(rd.includes(mtr), 'README must contain the start of examples/sample-mtr-output.txt');
});

test('README threshold table matches the code', () => {
  const rd = read('README.md'), T = G.T;
  assert.ok(rd.includes(`| **bad** if any is at or above | ${T.bad.loss_pct}% | ${T.bad.jitter_ms} ms | ${T.bad.p99_ms} ms | ${T.bad.spike_pct}% |`));
  assert.ok(rd.includes(`| **good** if all are at or below | ${T.good.loss_pct}% | ${T.good.jitter_ms} ms | ${T.good.p99_ms} ms | ${T.good.spike_pct}% |`));
  const html = read('index.html');
  assert.ok(html.includes(`packet loss &ge; ${T.bad.loss_pct}%`) && html.includes(`jitter &ge; ${T.bad.jitter_ms} ms`) && html.includes(`p99 &ge; ${T.bad.p99_ms} ms`) && html.includes(`spikes &ge; ${T.bad.spike_pct}%`));
  assert.ok(html.includes(`loss &le; ${T.good.loss_pct}%`) && html.includes(`jitter &le; ${T.good.jitter_ms} ms`) && html.includes(`p99 &le; ${T.good.p99_ms} ms`) && html.includes(`spikes &le; ${T.good.spike_pct}%`));
  assert.ok(html.includes(`median + ${T.spike_min_ms} ms`) && html.includes(`${T.spike_factor} x median`) && html.includes(`Below ${T.min_samples} replies`));
});

test('"more from the author" links carry the verified prices and the right hosts', () => {
  const rd = read('README.md').split('## More from the author')[1];
  const links = [...rd.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(m => new URL(m[1]).host);
  assert.ok(links.length >= 5);
  for (const h of links) assert.ok(['apify.com', 'vedovino.gumroad.com', 'github.com'].includes(h), h);
  for (const p of ['$0.0004', '$0.02', '$0.002', '$15', '$19']) assert.ok(rd.includes(p), p);
});

test('no network API, no external resource, no tracking, no storage in the shipped page code', () => {
  const NET = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|navigator\.geolocation|document\.cookie|indexedDB|localStorage|sessionStorage)\b/;
  for (const f of ['jitter.js', 'app.js']) assert.ok(!NET.test(read(f)), f);
  const html = read('index.html');
  for (const ref of html.match(/(?:src|href)="[^"]+"/g)) {
    const u = ref.slice(ref.indexOf('"') + 1, -1);
    if (/^https?:/.test(u)) assert.equal(u, 'https://github.com/MegaStretch23/game-jitter', 'only the repo link may be external: ' + u);
    else assert.ok(fs.existsSync(path.join(root, u)), 'missing ' + u);
  }
  assert.ok(!/<script[^>]+src="https?:/.test(html));
});

test('page claims are ones the code backs', () => {
  const all = read('index.html') + read('README.md');
  assert.ok(!/\b(guarantee|AI-powered|certified|official|best|proven|better than)\b/i.test(all));
  assert.ok(!/\b\d{3}[-. )]\d{3}[-. ]\d{4}\b/.test(all));   // no phone number
});
