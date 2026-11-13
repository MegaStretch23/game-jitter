import json, os, subprocess, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import game_jitter as g


def read(f):
    with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
        return fh.read()


def cli(*args, stdin=None):
    return subprocess.run([sys.executable, os.path.join(ROOT, "game_jitter.py"), *args], capture_output=True, text=True, input=stdin)


class Cases(unittest.TestCase):
    def test_cases_json(self):
        cases = json.loads(read("tests/cases.json"))
        self.assertGreaterEqual(len(cases), 8)
        for c in cases:
            r = g.run(c["input"])
            for k, v in c["expect"].items():
                self.assertEqual(r[k], v, "%s: %s" % (c["name"], k))

    def test_percentile_and_jitter(self):
        self.assertEqual(g.percentile(list(range(1, 101)), 95), 95)
        self.assertEqual(g.analyze([10.0, None, 50.0, 52.0])["jitter_ms"], 2)

    def test_edges(self):
        steady = lambda n: [20.0 + (i % 2) * 2 for i in range(n)]
        self.assertEqual(g.analyze(steady(30))["verdict"], "good")
        s = steady(199) + [None]
        self.assertEqual((g.analyze(s)["loss_pct"], g.analyze(s)["verdict"]), (0.5, "good"))
        self.assertEqual(g.analyze(steady(98) + [None, None])["verdict"], "bad")
        with self.assertRaises(ValueError):
            g.run("hello world")


class Saved(unittest.TestCase):
    def test_cli_matches_saved_text(self):
        for src, out in (("sample-ping.txt", "sample-output.txt"), ("sample-mtr.txt", "sample-mtr-output.txt")):
            p = cli(os.path.join(ROOT, "examples", src))
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(p.stdout, read("examples/" + out))

    def test_cli_json_matches_saved(self):
        p = cli(os.path.join(ROOT, "examples", "sample-ping.txt"), "--json")
        self.assertEqual(json.loads(p.stdout), json.loads(read("examples/sample-result.json")))

    def test_stdin_and_error_exit(self):
        p = cli("-", stdin=read("examples/sample-ping.txt"))
        self.assertEqual(p.returncode, 0); self.assertIn("Verdict: GOOD", p.stdout)
        p = cli("-", stdin="nothing useful here")
        self.assertEqual(p.returncode, 2); self.assertIn("no ping samples recognised", p.stderr)

    def test_sample_is_a_real_ping_run(self):
        t = read("examples/sample-ping.txt")
        import re
        m = re.search(r"(\d+) packets transmitted, (\d+) received", t)
        r = g.run(t)
        self.assertEqual((r["total"], r["received"]), (int(m.group(1)), int(m.group(2))))
        mm = re.search(r"min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)", t)
        self.assertAlmostEqual(r["mean_ms"], float(mm.group(2)), delta=0.01)
        self.assertAlmostEqual(r["max_ms"], float(mm.group(3)), delta=0.01)


if __name__ == "__main__":
    unittest.main()
