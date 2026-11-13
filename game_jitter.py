#!/usr/bin/env python3
"""Game Jitter CLI: mean, p95, p99, jitter, packet loss and spikes from ping output (Linux, macOS, Windows), mtr -r output or plain numbers.

    ping -c 60 -i 0.2 1.1.1.1 | python3 game_jitter.py -
    python3 game_jitter.py examples/sample-ping.txt
    python3 game_jitter.py examples/sample-ping.txt --json

Python 3.8+, standard library only, no network access. Same definitions as the browser tool (jitter.js); tests/cases.json is run against both.
"""
import argparse, json, math, re, sys

T = {"good": {"loss_pct": 0.5, "jitter_ms": 10, "p99_ms": 100, "spike_pct": 2},
     "bad": {"loss_pct": 2, "jitter_ms": 30, "p99_ms": 150, "spike_pct": 5},
     "spike_min_ms": 30, "spike_factor": 2, "min_samples": 20}


def round2(x):
    return None if x is None else math.floor(x * 100 + 0.5) / 100


def fmt(x):
    if x is None:
        return "n/a"
    if isinstance(x, float) and x == int(x):
        return str(int(x))
    return str(x)


def percentile(sorted_vals, p):
    return sorted_vals[max(0, math.ceil(p / 100 * len(sorted_vals)) - 1)]


def median(s):
    n = len(s); m = n >> 1
    return s[m] if n % 2 else (s[m - 1] + s[m]) / 2


LABEL = {"loss_pct": "packet loss", "jitter_ms": "jitter", "p99_ms": "p99 latency", "spike_pct": "spike share"}
UNIT = {"loss_pct": "%", "jitter_ms": " ms", "p99_ms": " ms", "spike_pct": "%"}


def verdict(m, reasons):
    bad = [k for k in m if m[k] >= T["bad"][k]]
    if bad:
        for k in bad:
            reasons.append("%s %s%s is at or above %s%s" % (LABEL[k], fmt(round2(m[k])), UNIT[k], fmt(T["bad"][k]), UNIT[k]))
        return "bad"
    mid = [k for k in m if m[k] > T["good"][k]]
    if mid:
        for k in mid:
            reasons.append("%s %s%s is above %s%s" % (LABEL[k], fmt(round2(m[k])), UNIT[k], fmt(T["good"][k]), UNIT[k]))
        return "borderline"
    reasons.append("loss, jitter, p99 and spikes are all within the good range")
    return "good"


def analyze(samples):
    total = len(samples)
    if not total:
        raise ValueError("no samples found")
    got = [x for x in samples if x is not None]
    lost = total - len(got)
    loss = lost / total * 100
    r = {"kind": "samples", "total": total, "received": len(got), "lost": lost, "loss_pct": round2(loss)}
    notes, reasons = [], []
    if not got:
        r.update(mean_ms=None, min_ms=None, max_ms=None, median_ms=None, p95_ms=None, p99_ms=None, jitter_ms=None, spikes=0, spike_pct=None, spike_threshold_ms=None)
        r["verdict"] = "bad"; reasons.append("every packet was lost")
        r["reasons"] = reasons; r["notes"] = notes
        return r
    s = sorted(got)
    total_ms = 0
    for x in got:
        total_ms += x
    mean, med = total_ms / len(got), median(s)
    dsum, pairs = 0, 0
    for i in range(1, len(samples)):
        if samples[i] is not None and samples[i - 1] is not None:
            dsum += abs(samples[i] - samples[i - 1]); pairs += 1
    jitter = dsum / pairs if pairs else None
    thr = max(T["spike_factor"] * med, med + T["spike_min_ms"])
    spikes = len([x for x in got if x > thr])
    spike_pct = spikes / len(got) * 100
    p95, p99 = percentile(s, 95), percentile(s, 99)
    r.update(mean_ms=round2(mean), min_ms=round2(s[0]), max_ms=round2(s[-1]), median_ms=round2(med), p95_ms=round2(p95), p99_ms=round2(p99),
             jitter_ms=round2(jitter), spikes=spikes, spike_pct=round2(spike_pct), spike_threshold_ms=round2(thr))
    if len(got) < T["min_samples"]:
        notes.append("only %d replies: p95 and p99 are not meaningful below %d; collect more samples" % (len(got), T["min_samples"]))
    if jitter is None:
        notes.append("no two consecutive replies, so jitter cannot be computed")
    r["verdict"] = verdict({"loss_pct": loss, "jitter_ms": 0 if jitter is None else jitter, "p99_ms": p99, "spike_pct": spike_pct}, reasons)
    r["reasons"] = reasons; r["notes"] = notes
    return r


MTR = re.compile(r"^\s*(\d+)\.\|--\s+(\S+)\s+([\d.]+)%?\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$")
SEQ_LOST = re.compile(r"(?:no answer yet for|Request timeout for) icmp_seq[= ]?(\d+)", re.I)
SEQ_OK = re.compile(r"icmp_seq[= ](\d+).*?\btime[=<]\s*([\d.]+)\s*ms", re.I)
WIN_OK = re.compile(r"\bReply from\b.*?\btime([=<])\s*([\d.]+)\s*ms", re.I)
WIN_LOST = re.compile(r"Request timed out|General failure|Destination (host|net(work)?) unreachable|TTL expired in transit", re.I)
SUM_LINUX = re.compile(r"(\d+) packets transmitted, (\d+)(?: packets)? received", re.I)
SUM_WIN = re.compile(r"Sent = (\d+), Received = (\d+)", re.I)
LOST_WORD = re.compile(r"^(timeout|timed|lost|loss|\*|-|nan|null)$", re.I)
NUM = re.compile(r"^\d+(\.\d+)?$")


def parse(text):
    lines = re.split(r"\r?\n", text)
    rows = []
    for ln in lines:
        m = MTR.match(ln)
        if m:
            g = m.groups()
            rows.append(dict(hop=int(g[0]), host=g[1], loss=float(g[2]), sent=int(g[3]), last=float(g[4]), avg=float(g[5]), fastest=float(g[6]), worst=float(g[7]), stdev=float(g[8])))
    if rows:
        return {"kind": "mtr", "rows": rows}
    samples, by_seq, st = [], {}, {"prev": None}
    transmitted, ping_lines = None, 0

    def fill(seq):
        if st["prev"] is not None and seq > st["prev"] + 1:
            for _ in range(st["prev"] + 1, seq):
                samples.append(None)

    for ln in lines:
        m = SEQ_LOST.search(ln)
        if m:
            seq = int(m.group(1)); ping_lines += 1
            if seq not in by_seq:
                fill(seq); by_seq[seq] = len(samples); samples.append(None); st["prev"] = seq
            continue
        m = SEQ_OK.search(ln)
        if m:
            seq, v = int(m.group(1)), float(m.group(2)); ping_lines += 1
            if seq in by_seq:
                if samples[by_seq[seq]] is None:
                    samples[by_seq[seq]] = v
            else:
                fill(seq); by_seq[seq] = len(samples); samples.append(v); st["prev"] = seq
            continue
        m = WIN_OK.search(ln)
        if m:
            ping_lines += 1; samples.append(float(m.group(2))); continue
        if WIN_LOST.search(ln):
            ping_lines += 1; samples.append(None); continue
        m = SUM_LINUX.search(ln) or SUM_WIN.search(ln)
        if m:
            transmitted = int(m.group(1))
    if ping_lines:
        while transmitted is not None and len(samples) < transmitted:
            samples.append(None)
        return {"kind": "ping", "samples": samples}
    out, ignored = [], 0
    for raw in re.split(r"[\s,;]+", text):
        t = re.sub(r"ms$", "", raw, flags=re.I)
        if not t:
            continue
        if LOST_WORD.match(t):
            out.append(None)
        elif NUM.match(t):
            out.append(float(t))
        else:
            ignored += 1
    if not out:
        raise ValueError("no ping samples recognised: paste ping output, mtr -r output, or numbers in milliseconds")
    return {"kind": "numbers", "samples": out, "ignored": ignored}


def analyze_mtr(rows):
    h = rows[-1]
    r = {"kind": "mtr", "host": h["host"], "hop": h["hop"], "total": h["sent"], "loss_pct": round2(h["loss"]), "mean_ms": round2(h["avg"]), "min_ms": round2(h["fastest"]),
         "max_ms": round2(h["worst"]), "last_ms": round2(h["last"]), "stdev_ms": round2(h["stdev"]), "median_ms": None, "p95_ms": None, "p99_ms": None,
         "jitter_ms": None, "spikes": None, "spike_pct": None}
    reasons = []
    notes = ["mtr report mode gives one summary line per hop, not individual replies: p95, p99, jitter and spikes are not available. "
             "The verdict uses packet loss, the standard deviation (as a rough stand-in for jitter) and the worst reply (as a stand-in for p99). Use ping output for the full set."]
    if h["sent"] < T["min_samples"]:
        notes.append("only %d probes were sent; use at least %d" % (h["sent"], T["min_samples"]))
    r["verdict"] = verdict({"loss_pct": h["loss"], "jitter_ms": h["stdev"], "p99_ms": h["worst"]}, reasons)
    r["reasons"] = reasons; r["notes"] = notes
    return r


def run(text):
    p = parse(text)
    if p["kind"] == "mtr":
        return analyze_mtr(p["rows"])
    r = analyze(p["samples"]); r["kind"] = p["kind"]
    if p.get("ignored"):
        r["notes"].append("%d word(s) in the input were not numbers and were skipped" % p["ignored"])
    return r


def report(r):
    v = fmt
    L = ["Verdict: " + r["verdict"].upper()] + ["  - " + s for s in r["reasons"]] + [""]
    L.append("Source: %s%s" % (r["kind"], " (last hop %s, %s)" % (r["hop"], r["host"]) if r["kind"] == "mtr" else ""))
    rec = r.get("received")
    L.append("Packets: %s sent/seen, %s replies, %s lost (%s%%)" % (r["total"], "n/a" if rec is None else rec, "n/a" if rec is None else r["lost"], v(r["loss_pct"])))
    L.append("Latency ms: mean %s, median %s, min %s, max %s" % (v(r["mean_ms"]), v(r["median_ms"]), v(r["min_ms"]), v(r["max_ms"])))
    L.append("Percentiles ms: p95 %s, p99 %s" % (v(r["p95_ms"]), v(r["p99_ms"])))
    L.append("Jitter ms: " + v(r["jitter_ms"]) + (" (stdev %s)" % v(r["stdev_ms"]) if r["kind"] == "mtr" else ""))
    sp = "Spikes: " + v(r["spikes"])
    if r.get("spike_threshold_ms") is not None:
        sp += " (above %s ms), %s%% of replies" % (v(r["spike_threshold_ms"]), v(r["spike_pct"]))
    L.append(sp)
    L += ["Note: " + n for n in r["notes"]]
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Latency statistics and a good/borderline/bad verdict from ping or mtr output.")
    ap.add_argument("file", help="ping/mtr output file, or - for stdin")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    a = ap.parse_args(argv)
    text = sys.stdin.read() if a.file == "-" else open(a.file, encoding="utf-8", errors="replace").read()
    try:
        r = run(text)
    except ValueError as e:
        print("error:", e, file=sys.stderr)
        return 2
    print(json.dumps(r, indent=2) if a.json else report(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
