# Game Jitter

Check your connection for competitive play. Give it ping samples and it reports **mean, p95 and p99 latency, jitter, packet loss and spike count**, then a plain verdict: **good**, **borderline** or **bad**.

**Use it in your browser:** https://megastretch23.github.io/game-jitter/

- A static page (`index.html`, `style.css`, `jitter.js`, `app.js`). No backend, no build step, no dependencies.
- Paste ping output (Linux, macOS or Windows), paste plain numbers in milliseconds, or load a `ping` or `mtr -r` output file. Files are read by the browser with `FileReader`; nothing is uploaded.
- The page makes no network requests of its own and has no analytics or storage.
- A small Python command-line version (`game_jitter.py`, standard library only) does the same calculation. `tests/cases.json` is run against both implementations, so they agree.

## Quickstart

Browser version, from a clone:

```bash
git clone https://github.com/MegaStretch23/game-jitter.git
cd game-jitter
python -m http.server 8000      # or: python3 -m http.server 8000
# open http://localhost:8000/ and paste your ping output
```

Command line:

```bash
ping -c 60 -i 0.2 1.1.1.1 > ping.txt      # Linux/macOS; on Windows: ping -n 60 1.1.1.1 > ping.txt
python3 game_jitter.py ping.txt            # or: ping ... | python3 game_jitter.py -
python3 game_jitter.py ping.txt --json     # same numbers as JSON
mtr -r -n -c 20 1.1.1.1 > mtr.txt && python3 game_jitter.py mtr.txt
```

Tests (Node 18 or newer and Python 3.8 or newer, nothing to install):

```bash
node --test tests/
python3 -m unittest discover -s tests -v
```

## What is computed

| Number | Definition |
|---|---|
| Packet loss | lost / sent. From the `icmp_seq` gaps, `Request timed out` lines and the summary line (lost packets at the end only show up in the summary). |
| Mean, median, min, max | over the replies that arrived. |
| p95, p99 | nearest rank: the value at position `ceil(p/100 x n)` of the sorted replies. Fewer than 20 replies and the tool says they are not meaningful. |
| Jitter | mean absolute difference between consecutive replies, in send order. A lost packet breaks the pair, so it is not bridged. |
| Spike | a reply above the larger of 2 x median and median + 30 ms. |

The verdict:

| | loss | jitter | p99 | spikes (share of replies) |
|---|---|---|---|---|
| **bad** if any is at or above | 2% | 30 ms | 150 ms | 5% |
| **good** if all are at or below | 0.5% | 10 ms | 100 ms | 2% |
| **borderline** | anything in between | | | |

These cutoffs are this tool's own rule of thumb for real-time games, not a standard, and a good verdict says nothing about the other end of the connection or the game server's own tick rate. `ping` measures ICMP round trips to the host you chose, not the game's traffic.

An `mtr -r` report has one summary line per hop and no individual replies, so for that input the tool reads the last hop only: loss, mean, fastest, slowest and standard deviation. Its verdict uses loss, the standard deviation (as a rough stand-in for jitter) and the worst reply (as a stand-in for p99), and it says so. p95, p99, jitter and spikes need ping output.

## Sample output (a saved run)

`examples/sample-ping.txt` is a real `ping -c 60 -i 0.2 -O 1.1.1.1` run, saved on 2026-11-13 from a cloud server in Germany. It is a quiet datacenter link, so it comes out good; it is here to show the format, not to represent a home connection. The command and its output:

```
$ python3 game_jitter.py examples/sample-ping.txt
Verdict: GOOD
  - loss, jitter, p99 and spikes are all within the good range

Source: ping
Packets: 60 sent/seen, 60 replies, 0 lost (0%)
Latency ms: mean 1.42, median 1.33, min 1.24, max 5.58
Percentiles ms: p95 1.53, p99 5.58
Jitter ms: 0.21
Spikes: 0 (above 31.33 ms), 0% of replies
```

The same for a saved `mtr -r -n -c 20 1.1.1.1` report (`examples/sample-mtr.txt`; the server's hostname is replaced with `host`):

```
$ python3 game_jitter.py examples/sample-mtr.txt
Verdict: GOOD
  - loss, jitter, p99 and spikes are all within the good range

Source: mtr (last hop 10, 1.1.1.1)
Packets: 20 sent/seen, n/a replies, n/a lost (0%)
Latency ms: mean 1.6, median n/a, min 1.3, max 5.1
Percentiles ms: p95 n/a, p99 n/a
Jitter ms: n/a (stdev 0.8)
Spikes: n/a
```

`examples/sample-output.txt` and `examples/sample-result.json` are written by the CLI; a test fails if they stop matching what the code produces, and another checks that the browser code gives the same numbers. The synthetic cases in `tests/cases.json` (a 200 ms spike, a lost packet, a Windows `time<1ms`, an all-lost run) have expected values worked out by hand.

## Layout

```
index.html  style.css  jitter.js  app.js   the page (jitter.js is the shared core, also loads in Node)
game_jitter.py                              command-line version
examples/                                   saved ping and mtr runs and the CLI output for them
tests/                                      node --test (core, README, no-network checks) and unittest (CLI)
```

## More from the author

Game Jitter is free and stays free. The same account also publishes paid tools, none of them related to ping or games (prices read from the live listings on 2026-11-13; check each page for the current price):

- [SEC Form 4 Scraper: Insider Buying Cluster Scanner](https://apify.com/johnveds15/sec-form4-insider-clusters?utm_source=github&utm_medium=readme&utm_campaign=game-jitter) on Apify: pay per event, $0.0004 per Form 4 filing parsed and $0.02 per insider cluster detected. Its free open-source core is [sec-form4-clusters](https://github.com/MegaStretch23/sec-form4-clusters).
- [CVE Vulnerability Scraper: NIST NVD, No API Key](https://apify.com/johnveds15/openvuln-cve-scanner?utm_source=github&utm_medium=readme&utm_campaign=game-jitter) on Apify: pay per event, $0.002 per CVE result.
- [Doom-detector for headless Claude Code runs](https://vedovino.gumroad.com/l/mjxcmw?utm_source=github&utm_medium=readme&utm_campaign=game-jitter) on Gumroad: $15.
- [blame-ai: AI-assist ledger for your git history (Python, local, no dependencies)](https://vedovino.gumroad.com/l/smhyy?utm_source=github&utm_medium=readme&utm_campaign=game-jitter) on Gumroad: $19.
- [pdfguard: find hidden prompt-injection text in PDFs before your LLM reads them (Python, local)](https://vedovino.gumroad.com/l/gvvcsh?utm_source=github&utm_medium=readme&utm_campaign=game-jitter) on Gumroad: $19.

None of these is needed to use Game Jitter.

## License

MIT, see `LICENSE`.
