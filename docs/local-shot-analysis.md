# Running Metic's shot-analysis algorithm locally

Metic analyses each shot with a **deterministic, no-LLM algorithm** before any
AI ever sees it. That algorithm decides, per stage, things like the *effective
control mode* (is this really a flow stage, or a pressure stage in disguise?),
whether an exit was *targeted* or a *failsafe*, whether the puck *stalled* or
*channeled*, and how far the shot drifted from the profile's target curve.

This guide shows you how to run that exact algorithm from your terminal against
real shot exports, and where to edit it if you want to tinker.

> The CLI wraps the **same code path the app uses in production**
> (`analysis_service._perform_local_shot_analysis` → `shot_facts.build_shot_facts`).
> No AI, no network, no machine required.

---

## 1. Prerequisites

- Python 3.13+ and the server dependencies installed in a virtualenv.

From the repository root:

```bash
cd apps/server
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Get a shot export

Export a shot from the Meticulous machine (or Metic's shot history). A shot file
is a JSON object with a `data` array of telemetry samples and, usually, an
embedded `profile`.

A real example is bundled for you:

```
apps/server/tools/samples/slayer_at_home.shot.json
```

## 3. Run the analyzer

Always run from `apps/server` (so the `services` package is importable):

```bash
cd apps/server
python -m tools.analyze_shot tools/samples/slayer_at_home.shot.json
```

You'll get a readable report:

```
Profile:      Slayer at Home
Temperature:  92 °C
Weight:       41.9 g (target 42 g)
Total time:   63.9 s
Max pressure: 7.2 bar
Max flow:     4.2 ml/s

Stage facts
-----------
• PreBrew
    control mode: flow
    trigger:      time → Targeted (timed transition)
    ...
• Extraction
    control mode: pressure (declared flow)
    ...
    curve delta:  target 10.8, measured 1.5, Δ -9.3
```

Note how **Extraction** is *declared* `flow` but resolves to an *effective*
`pressure` control mode: its dynamics push an aggressive flow target (10.8 ml/s)
that is really there to slam into a 6 bar pressure limit. That distinction is
exactly what the algorithm exists to detect (see issue #423).

### Options

| Command | Result |
| --- | --- |
| `python -m tools.analyze_shot <shot.json>` | Human-readable report using the profile embedded in the shot. |
| `python -m tools.analyze_shot <shot.json> <profile.json>` | Use a separate profile file instead of the embedded one. |
| `python -m tools.analyze_shot <shot.json> --json` | Print the full analysis object (including `shot_facts`) as JSON. |

Use `--json` to pipe into `jq`, diff two runs, or feed downstream tooling:

```bash
python -m tools.analyze_shot tools/samples/slayer_at_home.shot.json --json \
  | jq '.shot_facts.stages[] | {stage_name, control_mode, trigger_class: .trigger_class.label}'
```

## 4. Where the algorithm lives (edit these to tinker)

| File | Responsibility |
| --- | --- |
| `apps/server/services/shot_facts.py` | The interesting logic: `effective_control_mode`, `classify_trigger`, `detect_stall`, `detect_channeling`, curve adherence, and `build_shot_facts`. **Start here.** |
| `apps/server/services/analysis_service.py` | Per-stage execution extraction, dynamics/target resolution (`_stage_dynamics`, `_mean_dynamics_target`, `_max_dynamics_target`), and `_perform_local_shot_analysis` (the orchestrator the CLI calls). |
| `apps/server/tools/analyze_shot.py` | The CLI itself (loading, reporting). |

Tune a threshold, re-run the CLI, compare the output — that's the whole loop.
For example, the effective-mode thresholds live at the top of `shot_facts.py`:

```python
EFFECTIVE_FLOW_TARGET_MIN = 6.0   # flow target ≥ this + pressure limit ⇒ pressure
EFFECTIVE_FLOW_LIMIT_MAX = 3.0    # pressure stage w/ flow limit ≤ this ⇒ flow
```

## 5. Keep the two runtimes in sync ⚠️

Metic ships this logic **twice**: once in Python (above) and once in TypeScript
for the native/on-device app, which has no Python server:

- `apps/web/src/lib/shotFacts.ts` — mirror of `shot_facts.py`
- `apps/web/src/services/interceptor/DirectModeInterceptor.ts` — mirror of the
  `analysis_service.py` stage pipeline (`computeRichLocalAnalysis`).

If you change a threshold or rule in Python, make the identical change in the
TypeScript mirror (and vice-versa), with tests on both sides. Mismatched
behaviour between the two runtimes is a release-blocking bug.

## 6. Tests

```bash
cd apps/server
TEST_MODE=true .venv/bin/python -m pytest test_analyze_shot.py -q
```

These exercise the CLI against synthetic fixtures and the bundled real
`slayer_at_home.shot.json` export.
