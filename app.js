'use strict';
// Browser UI for Game Jitter. Reads only what the user pastes or opens; nothing leaves the page.
(function () {
  const $ = id => document.getElementById(id);
  const G = window.GameJitter;
  const EXAMPLE = '21 22 20 23 21 22 20 21 24 22 21 20 95 22 21 23 timeout 22 21 20 22 23 21 140 22 21 20 22 21 23';
  let lastText = '';

  function td(a, b) { const tr = document.createElement('tr'); const h = document.createElement('th'); h.textContent = a; const d = document.createElement('td'); d.textContent = b; tr.append(h, d); return tr; }
  const v = x => x === null || x === undefined ? 'n/a' : String(x);

  function chart(samples) {
    const svg = $('chart'); while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.style.display = samples && samples.length ? '' : 'none';
    if (!samples || !samples.length) return;
    const got = samples.filter(x => x !== null), top = Math.max.apply(null, got.concat([1])) * 1.1, W = 600, H = 120, n = samples.length;
    const NS = 'http://www.w3.org/2000/svg', x = i => n === 1 ? W / 2 : 8 + i * (W - 16) / (n - 1), y = s => H - 8 - s / top * (H - 16);
    let d = '', pen = false;
    samples.forEach((s, i) => { if (s === null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s).toFixed(1); pen = true; });
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#58a6ff'); p.setAttribute('stroke-width', '1.5'); svg.appendChild(p);
    samples.forEach((s, i) => { if (s === null) { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x(i)); l.setAttribute('x2', x(i)); l.setAttribute('y1', 0); l.setAttribute('y2', H); l.setAttribute('stroke', '#f85149'); l.setAttribute('stroke-width', '1'); svg.appendChild(l); } });
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', 6); t.setAttribute('y', 14); t.setAttribute('fill', '#9aa7b4'); t.setAttribute('font-size', '11');
    t.textContent = 'max ' + Math.max.apply(null, got) + ' ms; red line = lost packet'; svg.appendChild(t);
  }

  function show(text) {
    $('err').hidden = true; lastText = text;
    let r;
    try { r = G.run(text); } catch (e) { $('out').hidden = true; $('err').textContent = e.message; $('err').hidden = false; return; }
    $('out').hidden = false;
    const b = $('badge'); b.textContent = r.verdict.toUpperCase(); b.className = 'badge ' + r.verdict;
    const ul = $('reasons'); ul.textContent = ''; r.reasons.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    const t = $('tbl'); t.textContent = '';
    t.append(td('Packets', r.total + (r.received === undefined ? '' : ' (' + r.received + ' replies, ' + r.lost + ' lost)')), td('Packet loss', v(r.loss_pct) + ' %'),
      td('Mean', v(r.mean_ms) + ' ms'), td('Median', v(r.median_ms) + ' ms'), td('Min / max', v(r.min_ms) + ' / ' + v(r.max_ms) + ' ms'),
      td('p95', v(r.p95_ms) + ' ms'), td('p99', v(r.p99_ms) + ' ms'), td('Jitter', v(r.jitter_ms) + ' ms'),
      td('Spikes', v(r.spikes) + (r.spike_threshold_ms ? ' (above ' + r.spike_threshold_ms + ' ms)' : '')));
    chart(r.samples);
    const nl = $('notes'); nl.textContent = ''; r.notes.forEach(s => { const li = document.createElement('li'); li.textContent = s; nl.appendChild(li); });
  }

  $('go').addEventListener('click', () => show($('in').value));
  $('ex').addEventListener('click', () => { $('in').value = EXAMPLE.split(' ').join('\n'); show($('in').value); });
  $('file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => { $('in').value = rd.result; show(rd.result); }; rd.readAsText(f);
  });
  $('copy').addEventListener('click', () => { try { navigator.clipboard.writeText(G.report(G.run(lastText))); } catch (e) { $('err').textContent = 'Copy failed: ' + e.message; $('err').hidden = false; } });
})();
