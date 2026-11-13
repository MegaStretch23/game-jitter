'use strict';
// Game Jitter core: parse ping/mtr output or plain numbers, compute latency statistics, give a verdict.
// Pure functions, no DOM, no network. Loads in the browser (window.GameJitter) and in Node (require).
// The Python CLI (game_jitter.py) implements the same definitions; tests/cases.json is run against both.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameJitter = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Verdict cutoffs. These are this tool's own rule of thumb for real-time games, not a standard.
  const T = {
    good: { loss_pct: 0.5, jitter_ms: 10, p99_ms: 100, spike_pct: 2 },
    bad: { loss_pct: 2, jitter_ms: 30, p99_ms: 150, spike_pct: 5 },
    spike_min_ms: 30,       // a spike is a sample above max(2 x median, median + spike_min_ms)
    spike_factor: 2,
    min_samples: 20,        // below this, p95/p99 are not meaningful (a note says so)
  };

  const round2 = x => (x === null || x === undefined ? null : Math.floor(x * 100 + 0.5) / 100);

  function percentile(sorted, p) {            // nearest rank: sorted[ceil(p/100 * n) - 1]
    const n = sorted.length;
    return sorted[Math.max(0, Math.ceil(p / 100 * n) - 1)];
  }

  function median(sorted) {
    const n = sorted.length, m = n >> 1;
    return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }

  // samples: array of numbers (ms) or null (lost packet), in send order.
  function analyze(samples) {
    const total = samples.length;
    const got = samples.filter(x => x !== null);
    if (!total) throw new Error('no samples found');
    const lost = total - got.length;
    const loss = lost / total * 100;
    const r = { kind: 'samples', total, received: got.length, lost, loss_pct: round2(loss) };
    const notes = [], reasons = [];
    if (!got.length) {
      Object.assign(r, { mean_ms: null, min_ms: null, max_ms: null, median_ms: null, p95_ms: null, p99_ms: null, jitter_ms: null, spikes: 0, spike_pct: null, spike_threshold_ms: null });
      r.verdict = 'bad'; reasons.push('every packet was lost');
      r.reasons = reasons; r.notes = notes; return r;
    }
    const sorted = got.slice().sort((a, b) => a - b);
    let sum = 0; for (const x of got) sum += x;
    const mean = sum / got.length, med = median(sorted);
    let dsum = 0, pairs = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i] !== null && samples[i - 1] !== null) { dsum += Math.abs(samples[i] - samples[i - 1]); pairs++; }
    const jitter = pairs ? dsum / pairs : null;
    const thr = Math.max(T.spike_factor * med, med + T.spike_min_ms);
    const spikes = got.filter(x => x > thr).length;
    const spikePct = spikes / got.length * 100;
    const p95 = percentile(sorted, 95), p99 = percentile(sorted, 99);
    Object.assign(r, { mean_ms: round2(mean), min_ms: round2(sorted[0]), max_ms: round2(sorted[sorted.length - 1]), median_ms: round2(med),
      p95_ms: round2(p95), p99_ms: round2(p99), jitter_ms: round2(jitter), spikes, spike_pct: round2(spikePct), spike_threshold_ms: round2(thr) });
    if (got.length < T.min_samples) notes.push(`only ${got.length} replies: p95 and p99 are not meaningful below ${T.min_samples}; collect more samples`);
    if (jitter === null) notes.push('no two consecutive replies, so jitter cannot be computed');
    const m = { loss_pct: loss, jitter_ms: jitter === null ? 0 : jitter, p99_ms: p99, spike_pct: spikePct };
    r.verdict = verdict(m, reasons);
    r.reasons = reasons; r.notes = notes; return r;
  }

  function verdict(m, reasons) {
    const label = { loss_pct: 'packet loss', jitter_ms: 'jitter', p99_ms: 'p99 latency', spike_pct: 'spike share' };
    const unit = { loss_pct: '%', jitter_ms: ' ms', p99_ms: ' ms', spike_pct: '%' };
    const bad = Object.keys(m).filter(k => m[k] >= T.bad[k]);
    if (bad.length) { for (const k of bad) reasons.push(`${label[k]} ${round2(m[k])}${unit[k]} is at or above ${T.bad[k]}${unit[k]}`); return 'bad'; }
    const mid = Object.keys(m).filter(k => m[k] > T.good[k]);
    if (mid.length) { for (const k of mid) reasons.push(`${label[k]} ${round2(m[k])}${unit[k]} is above ${T.good[k]}${unit[k]}`); return 'borderline'; }
    reasons.push('loss, jitter, p99 and spikes are all within the good range');
    return 'good';
  }

  // mtr report mode has per-hop summaries only. Use the last hop; stdev stands in for jitter, worst for p99. Marked in the result.
  const MTR = /^\s*(\d+)\.\|--\s+(\S+)\s+([\d.]+)%?\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/;
  function analyzeMtr(rows) {
    const h = rows[rows.length - 1];
    const r = { kind: 'mtr', host: h.host, hop: h.hop, total: h.sent, loss_pct: round2(h.loss), mean_ms: round2(h.avg), min_ms: round2(h.fastest), max_ms: round2(h.worst),
      last_ms: round2(h.last), stdev_ms: round2(h.stdev), median_ms: null, p95_ms: null, p99_ms: null, jitter_ms: null, spikes: null, spike_pct: null };
    const reasons = [], notes = ['mtr report mode gives one summary line per hop, not individual replies: p95, p99, jitter and spikes are not available. '
      + 'The verdict uses packet loss, the standard deviation (as a rough stand-in for jitter) and the worst reply (as a stand-in for p99). Use ping output for the full set.'];
    if (h.sent < T.min_samples) notes.push(`only ${h.sent} probes were sent; use at least ${T.min_samples}`);
    r.verdict = verdict({ loss_pct: h.loss, jitter_ms: h.stdev, p99_ms: h.worst }, reasons);
    r.reasons = reasons; r.notes = notes; return r;
  }

  function parse(text) {
    const lines = String(text).split(/\r?\n/);
    const rows = [];
    for (const ln of lines) {
      const m = MTR.exec(ln);
      if (m) rows.push({ hop: +m[1], host: m[2], loss: +m[3], sent: +m[4], last: +m[5], avg: +m[6], fastest: +m[7], worst: +m[8], stdev: +m[9] });
    }
    if (rows.length) return { kind: 'mtr', rows };
    const samples = [], bySeq = new Map();
    let prev = null, transmitted = null, pingLines = 0;
    for (const ln of lines) {
      let m;
      if ((m = /(?:no answer yet for|Request timeout for) icmp_seq[= ]?(\d+)/i.exec(ln))) {
        const seq = +m[1]; pingLines++;
        if (!bySeq.has(seq)) { fill(seq); bySeq.set(seq, samples.length); samples.push(null); prev = seq; }
      } else if ((m = /icmp_seq[= ](\d+).*?\btime[=<]\s*([\d.]+)\s*ms/i.exec(ln))) {
        const seq = +m[1], v = +m[2]; pingLines++;
        if (bySeq.has(seq)) { if (samples[bySeq.get(seq)] === null) samples[bySeq.get(seq)] = v; }   // late reply to an earlier "no answer yet"; a DUP! is ignored
        else { fill(seq); bySeq.set(seq, samples.length); samples.push(v); prev = seq; }
      } else if ((m = /\bReply from\b.*?\btime([=<])\s*([\d.]+)\s*ms/i.exec(ln))) {   // Windows: time=12ms, time<1ms (counted as 1)
        pingLines++; samples.push(+m[2]);
      } else if (/Request timed out|General failure|Destination (host|net(work)?) unreachable|TTL expired in transit/i.test(ln)) {
        pingLines++; samples.push(null);
      } else if ((m = /(\d+) packets transmitted, (\d+)(?: packets)? received/i.exec(ln))) transmitted = +m[1];
      else if ((m = /Sent = (\d+), Received = (\d+)/i.exec(ln))) transmitted = +m[1];
    }
    function fill(seq) { if (prev !== null && seq > prev + 1) for (let i = prev + 1; i < seq; i++) samples.push(null); }
    if (pingLines) {
      while (transmitted !== null && samples.length < transmitted) samples.push(null);   // lost packets at the end have no line of their own
      return { kind: 'ping', samples };
    }
    // plain numbers: whitespace, comma or semicolon separated; "timeout", "lost", "*", "-" count as lost
    const out = []; let ignored = 0;
    for (const raw of text.split(/[\s,;]+/)) {
      const t = raw.replace(/ms$/i, '');
      if (!t) continue;
      if (/^(timeout|timed|lost|loss|\*|-|nan|null)$/i.test(t)) out.push(null);
      else if (/^\d+(\.\d+)?$/.test(t)) out.push(+t);
      else ignored++;
    }
    if (!out.length) throw new Error('no ping samples recognised: paste ping output, mtr -r output, or numbers in milliseconds');
    return { kind: 'numbers', samples: out, ignored };
  }

  function run(text) {
    const p = parse(text);
    if (p.kind === 'mtr') return analyzeMtr(p.rows);
    const r = analyze(p.samples); r.kind = p.kind;
    if (p.ignored) r.notes.push(`${p.ignored} word(s) in the input were not numbers and were skipped`);
    r.samples = p.samples; return r;
  }

  function report(r) {
    const v = x => x === null || x === undefined ? 'n/a' : x;
    const L = [`Verdict: ${r.verdict.toUpperCase()}`, ...r.reasons.map(s => '  - ' + s), '',
      `Source: ${r.kind}${r.kind === 'mtr' ? ` (last hop ${r.hop}, ${r.host})` : ''}`,
      `Packets: ${r.total} sent/seen, ${r.received === undefined ? 'n/a' : r.received} replies, ${r.received === undefined ? 'n/a' : r.lost} lost (${v(r.loss_pct)}%)`,
      `Latency ms: mean ${v(r.mean_ms)}, median ${v(r.median_ms)}, min ${v(r.min_ms)}, max ${v(r.max_ms)}`,
      `Percentiles ms: p95 ${v(r.p95_ms)}, p99 ${v(r.p99_ms)}`,
      `Jitter ms: ${v(r.jitter_ms)}` + (r.kind === 'mtr' ? ` (stdev ${v(r.stdev_ms)})` : ''),
      `Spikes: ${v(r.spikes)}` + (r.spike_threshold_ms !== undefined && r.spike_threshold_ms !== null ? ` (above ${r.spike_threshold_ms} ms), ${v(r.spike_pct)}% of replies` : '')];
    for (const n of r.notes) L.push('Note: ' + n);
    return L.join('\n');
  }

  return { T, parse, analyze, run, report, percentile, round2 };
});
