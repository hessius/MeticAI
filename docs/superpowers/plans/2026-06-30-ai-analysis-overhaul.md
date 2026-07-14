# AI Shot Analysis Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI shot analysis consistent across model sizes by adding a deterministic `ShotFacts` layer (incl. #423 Targeted/Failsafe trigger classification), feeding the AI digested facts + an analysis knowledge base + few-shot example, validating output against the facts, and integrating the Espresso Compass as an optional pre-analysis step — all mirrored across the Python (server) and TypeScript (native) runtimes.

**Architecture:** A pure deterministic function (`build_shot_facts` / `buildShotFacts`) turns telemetry + profile + existing local analysis into a typed `ShotFacts` object. That object feeds (a) the enriched static analysis view, (b) a prose fact-sheet for the LLM prompt, and (c) a semantic validator that rejects/repairs AI claims contradicting the facts. The Espresso Compass becomes an optional pre-analysis step whose taste feeds both the AI and deterministic adjustment rules.

**Tech Stack:** Python 3.13 / FastAPI / pytest (server); React + TypeScript / Vite / Vitest / Bun (native); i18n via react-i18next across 6 locales.

**Spec:** `docs/superpowers/specs/2026-06-30-ai-analysis-overhaul-design.md`

---

## Dual-Runtime Rule (read first)

Every behavior is implemented **twice** and must stay numerically/structurally identical:

- **Server:** `apps/server/` (Python). Tests in `apps/server/test_*.py`, run with
  `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest <file> -q`.
- **Native:** `apps/web/` (TypeScript). Tests run with
  `cd apps/web && bun run test:run -- --reporter=dot <paths>`
  (the default reporter hangs; always pass `--reporter=dot` and explicit file paths).

Mismatched behavior between runtimes is a **release-blocking** bug. Each phase below pairs the
server task with its native parity task. Keep threshold constants identical across runtimes.

**Baselines (do not regress):** server full suite currently green; web `tsc` has exactly 2
pre-existing errors (`useGenerationProgress.ts:94`, `test/setup.ts:57`) — add none; lint 0
errors. i18n: all locale files currently have equal key counts — a parity test enforces this.

**Commit convention:** Conventional Commits + trailer
`Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
NEVER stage `apps/web/ios/App/App.xcodeproj/project.pbxproj`.

---

## File Structure

### New files
- `apps/server/services/shot_facts.py` — pure `build_shot_facts()` + `classify_trigger()` +
  detectors (D1–D5). Typed dataclasses. No I/O, no LLM.
- `apps/server/analysis_knowledge.py` — `ANALYSIS_KNOWLEDGE` constant (K1) + `build_fact_sheet()` (K2).
- `apps/server/services/compass_rules.py` — `compass_adjustments()` (D6).
- `apps/server/services/analysis_validator.py` — `validate_analysis()` (K4/L1–L4) + shared schema.
- `apps/web/src/lib/shotFacts.ts` — TS parity of `shot_facts.py` (D1–D5) + types.
- `apps/web/src/services/ai/analysisKnowledge.ts` — `ANALYSIS_KNOWLEDGE` + `buildFactSheet()`.
- `apps/web/src/lib/compassRules.ts` — `compassAdjustments()` (D6).
- `apps/web/src/lib/analysisSchema.ts` — shared section-schema definition (L2), consumed by
  prompt builder + linter.
- Test files alongside each (`shot_facts` tests live in `apps/server/test_main.py` additions
  for server; `apps/web/src/lib/shotFacts.test.ts` etc. for native).

### Modified files
- `apps/server/services/analysis_service.py` — call `build_shot_facts`, add facts to
  `local_analysis`; `_prepare_shot_summary_for_llm` gains fact-sheet output.
- `apps/server/api/routes/shots.py` — analyze-llm route: inject fact sheet + `ANALYSIS_KNOWLEDGE`,
  run `validate_analysis`, accept taste already supported (`taste_x/taste_y/descriptors`).
- `apps/server/prompt_builder.py` — reuse existing `build_taste_context` (no change unless noted).
- `apps/web/src/services/interceptor/DirectModeInterceptor.ts` — inject `ANALYSIS_KNOWLEDGE`,
  fact sheet, `buildTasteContext`, and run validator (currently returns raw text).
- `apps/web/src/lib/analysisLint.ts` — extend to schema/bounds/anti-hallucination (L1/L4).
- `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` — render Targeted/Failsafe badges,
  stall/channeling flags, phase breakdown, curve-adherence (enrich static view).
- `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json` — new keys.

---

## Phase 1 — Deterministic Fact Layer (#423) + Static View

### Task 1: Trigger classification — server (D1)

**Files:**
- Create: `apps/server/services/shot_facts.py`
- Test: `apps/server/test_main.py` (append a `TestShotFactsClassify` class)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestShotFactsClassify:
    """#423 Targeted vs Failsafe trigger classification."""

    def test_weight_is_always_targeted(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("pressure", "weight", total_triggers=2)
        assert r["kind"] == "targeted"
        assert "yield" in r["label"].lower()

    def test_time_only_trigger_is_planned_duration(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("flow", "time", total_triggers=1)
        assert r["kind"] == "targeted"
        assert "planned" in r["label"].lower()

    def test_time_with_other_triggers_is_failsafe_timeout(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("flow", "time", total_triggers=2)
        assert r["kind"] == "failsafe"
        assert "timeout" in r["label"].lower()

    def test_flow_control_pressure_trigger_is_puck_resistance(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("flow", "pressure", total_triggers=2)
        assert r["kind"] == "targeted"
        assert "resistance" in r["label"].lower()

    def test_pressure_control_flow_only_trigger_is_planned_transition(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("pressure", "flow", total_triggers=1)
        assert r["kind"] == "targeted"

    def test_pressure_control_flow_with_others_is_failsafe_channeling(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("pressure", "flow", total_triggers=2)
        assert r["kind"] == "failsafe"
        assert "channel" in r["label"].lower() or "chok" in r["label"].lower()

    def test_pressure_control_pressure_trigger_is_threshold(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("pressure", "pressure", total_triggers=1)
        assert r["kind"] == "targeted"

    def test_unknown_combo_returns_unknown(self):
        from services.shot_facts import classify_trigger
        r = classify_trigger("power", "weird", total_triggers=1)
        assert r["kind"] == "unknown"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestShotFactsClassify -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.shot_facts'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/services/shot_facts.py`:

```python
"""Deterministic shot-fact derivation (#423 + diagnostic signals).

Pure functions: telemetry + profile + local analysis -> typed facts. No I/O, no LLM.
Mirrors apps/web/src/lib/shotFacts.ts — keep thresholds identical across runtimes.
"""

from __future__ import annotations


def classify_trigger(
    stage_control_mode: str, trigger_type: str, total_triggers: int
) -> dict:
    """Classify a stage's exit trigger as Targeted vs Failsafe (#423).

    Args:
        stage_control_mode: the variable the stage controls ('pressure' | 'flow' | other).
        trigger_type: the exit trigger that fired ('weight' | 'time' | 'pressure' | 'flow').
        total_triggers: number of exit triggers defined on the stage.

    Returns:
        {'kind': 'targeted'|'failsafe'|'unknown', 'label': str, 'reason': str}
    """
    if trigger_type == "weight":
        return {
            "kind": "targeted",
            "label": "Targeted (yield reached)",
            "reason": "Weight is the ultimate goal of the shot.",
        }
    if trigger_type == "time":
        if total_triggers == 1:
            return {
                "kind": "targeted",
                "label": "Targeted (planned duration)",
                "reason": "Time is the only trigger, so this is an intentional timed stage.",
            }
        return {
            "kind": "failsafe",
            "label": "Failsafe (timeout limit)",
            "reason": "Stage hit its time backstop before another target was reached.",
        }
    if stage_control_mode == "flow" and trigger_type == "pressure":
        return {
            "kind": "targeted",
            "label": "Targeted (puck resistance achieved)",
            "reason": "Flow-controlled stage reached its intended pressure.",
        }
    if stage_control_mode == "pressure" and trigger_type == "flow":
        if total_triggers == 1:
            return {
                "kind": "targeted",
                "label": "Targeted (planned flow transition)",
                "reason": "Flow is the only trigger, so the transition is intentional.",
            }
        return {
            "kind": "failsafe",
            "label": "Failsafe (caught channeling or choking)",
            "reason": "Pressure-controlled stage exited on a flow backstop.",
        }
    if stage_control_mode == "pressure" and trigger_type == "pressure":
        return {
            "kind": "targeted",
            "label": "Targeted (pressure threshold reached)",
            "reason": "Pressure-controlled stage reached its target pressure.",
        }
    return {
        "kind": "unknown",
        "label": "Unknown",
        "reason": "Trigger/control-mode combination is not classified.",
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestShotFactsClassify -q`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add apps/server/services/shot_facts.py apps/server/test_main.py
git commit -m "feat(analysis): add #423 Targeted/Failsafe trigger classification (server)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Shot-fact detectors + builder — server (D2–D5)

**Files:**
- Modify: `apps/server/services/shot_facts.py`
- Test: `apps/server/test_main.py` (append `TestShotFacts`)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestShotFacts:
    def _stage(self, **kw):
        base = {
            "stage_name": "Infusion",
            "stage_type": "flow",
            "exit_triggers": [],
            "execution_data": {
                "duration": 10.0, "weight_gain": 2.0, "end_weight": 8.0,
                "start_pressure": 1.0, "end_pressure": 6.0, "avg_pressure": 4.0,
                "max_pressure": 6.5, "min_pressure": 1.0,
                "start_flow": 4.0, "end_flow": 0.5, "avg_flow": 2.0, "max_flow": 4.5,
            },
            "exit_trigger_result": {"triggered": {"type": "time"}},
        }
        base.update(kw)
        return base

    def test_stall_detected_on_time_failsafe_with_low_gain(self):
        from services.shot_facts import detect_stall
        stage = self._stage(
            stage_type="pressure",
            exit_triggers=[{"type": "flow"}, {"type": "time"}],
            exit_trigger_result={"triggered": {"type": "time"}},
            execution_data={**self._stage()["execution_data"], "weight_gain": 0.3},
        )
        assert detect_stall(stage)["stalled"] is True

    def test_no_stall_when_weight_trigger(self):
        from services.shot_facts import detect_stall
        stage = self._stage(exit_trigger_result={"triggered": {"type": "weight"}})
        assert detect_stall(stage)["stalled"] is False

    def test_channeling_flag_on_pressure_drop_with_flow_rise(self):
        from services.shot_facts import detect_channeling
        ed = {**self._stage()["execution_data"],
              "start_pressure": 8.0, "end_pressure": 3.0,
              "start_flow": 1.0, "end_flow": 5.0}
        assert detect_channeling(ed)["channeling"] is True

    def test_no_channeling_on_stable_stage(self):
        from services.shot_facts import detect_channeling
        ed = {**self._stage()["execution_data"],
              "start_pressure": 6.0, "end_pressure": 6.2,
              "start_flow": 2.0, "end_flow": 2.1}
        assert detect_channeling(ed)["channeling"] is False

    def test_build_shot_facts_classifies_each_stage(self):
        from services.shot_facts import build_shot_facts
        local = {
            "stage_analyses": [
                self._stage(
                    stage_type="pressure",
                    exit_triggers=[{"type": "weight"}],
                    exit_trigger_result={"triggered": {"type": "weight"}},
                ),
            ],
            "weight_analysis": {"actual": 36.0, "target": 36.0, "deviation_percent": 0.0},
            "overall_metrics": {"total_time": 30.0},
        }
        facts = build_shot_facts(local)
        assert len(facts["stages"]) == 1
        assert facts["stages"][0]["trigger_class"]["kind"] == "targeted"
        assert "phases" in facts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestShotFacts -q`
Expected: FAIL — `ImportError: cannot import name 'detect_stall'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/server/services/shot_facts.py`:

```python
# Threshold constants — keep identical to apps/web/src/lib/shotFacts.ts
STALL_MIN_WEIGHT_GAIN_G = 0.5  # below this on a time-failsafe = stalled
CHANNELING_PRESSURE_DROP_BAR = 1.5  # pressure fall within a stage
CHANNELING_FLOW_RISE_MLS = 1.5  # simultaneous flow rise


def _stage_control_mode(stage: dict) -> str:
    """Best-effort: which variable the stage controls."""
    t = (stage.get("stage_type") or stage.get("type") or "").lower()
    if "flow" in t:
        return "flow"
    if "pressure" in t:
        return "pressure"
    return "unknown"


def detect_stall(stage: dict) -> dict:
    """A stage stalled if it exited on a time failsafe with negligible weight gain."""
    result = stage.get("exit_trigger_result") or {}
    triggered = result.get("triggered") or {}
    trig_type = triggered.get("type", "")
    total = len(stage.get("exit_triggers") or [])
    ed = stage.get("execution_data") or {}
    gain = float(ed.get("weight_gain", 0) or 0)
    klass = classify_trigger(_stage_control_mode(stage), trig_type, total)
    stalled = klass["kind"] == "failsafe" and trig_type == "time" and gain < STALL_MIN_WEIGHT_GAIN_G
    return {"stalled": stalled, "weight_gain": round(gain, 2)}


def detect_channeling(execution_data: dict) -> dict:
    """Flag likely channeling: pressure falls while flow rises within the stage."""
    ed = execution_data or {}
    p_drop = float(ed.get("start_pressure", 0) or 0) - float(ed.get("end_pressure", 0) or 0)
    f_rise = float(ed.get("end_flow", 0) or 0) - float(ed.get("start_flow", 0) or 0)
    channeling = p_drop >= CHANNELING_PRESSURE_DROP_BAR and f_rise >= CHANNELING_FLOW_RISE_MLS
    return {"channeling": channeling, "pressure_drop": round(p_drop, 2), "flow_rise": round(f_rise, 2)}


def _build_phases(local_analysis: dict) -> list[dict]:
    """Group stages into pre-infusion / ramp / peak / decline by avg pressure shape."""
    stages = [s for s in local_analysis.get("stage_analyses", []) if s.get("execution_data")]
    phases: list[dict] = []
    for s in stages:
        ed = s["execution_data"]
        avg_p = float(ed.get("avg_pressure", 0) or 0)
        if avg_p < 3.0:
            phase = "pre-infusion"
        elif float(ed.get("end_pressure", 0) or 0) > float(ed.get("start_pressure", 0) or 0):
            phase = "ramp"
        elif float(ed.get("end_pressure", 0) or 0) < float(ed.get("start_pressure", 0) or 0):
            phase = "decline"
        else:
            phase = "peak"
        phases.append({
            "stage_name": s.get("stage_name"),
            "phase": phase,
            "avg_pressure": ed.get("avg_pressure"),
            "avg_flow": ed.get("avg_flow"),
            "weight_gain": ed.get("weight_gain"),
        })
    return phases


def _curve_adherence(stage: dict) -> dict | None:
    """Compare measured avg vs the stage's first target dynamics point, if numeric."""
    points = ((stage.get("profile_target") or {}) if isinstance(stage.get("profile_target"), dict) else {})
    target = points.get("target_value")
    ed = stage.get("execution_data") or {}
    if target is None:
        return None
    mode = _stage_control_mode(stage)
    measured = ed.get("avg_pressure") if mode == "pressure" else ed.get("avg_flow")
    if measured is None:
        return None
    return {"target": target, "measured": measured, "delta": round(float(measured) - float(target), 2)}


def build_shot_facts(local_analysis: dict) -> dict:
    """Assemble the deterministic ShotFacts object consumed by the static view, the
    LLM fact sheet, and the validator. Mirrors buildShotFacts() in shotFacts.ts."""
    stages_out: list[dict] = []
    for s in local_analysis.get("stage_analyses", []):
        ed = s.get("execution_data")
        if not ed:
            stages_out.append({"stage_name": s.get("stage_name"), "reached": False})
            continue
        triggered = (s.get("exit_trigger_result") or {}).get("triggered") or {}
        trig_type = triggered.get("type", "")
        total = len(s.get("exit_triggers") or [])
        stages_out.append({
            "stage_name": s.get("stage_name"),
            "reached": True,
            "control_mode": _stage_control_mode(s),
            "trigger_type": trig_type,
            "trigger_class": classify_trigger(_stage_control_mode(s), trig_type, total),
            "stall": detect_stall(s),
            "channeling": detect_channeling(ed),
            "curve_adherence": _curve_adherence(s),
        })
    wa = local_analysis.get("weight_analysis", {})
    return {
        "stages": stages_out,
        "phases": _build_phases(local_analysis),
        "weight": {
            "actual": wa.get("actual"),
            "target": wa.get("target"),
            "deviation_pct": wa.get("deviation_percent"),
        },
        "total_time_s": local_analysis.get("overall_metrics", {}).get("total_time"),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestShotFacts -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add apps/server/services/shot_facts.py apps/server/test_main.py
git commit -m "feat(analysis): add stall/channeling/phase/curve detectors + build_shot_facts (server)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Wire ShotFacts into server local analysis output

**Files:**
- Modify: `apps/server/services/analysis_service.py` (`_perform_local_shot_analysis` return)
- Test: `apps/server/test_main.py` (append to existing local-analysis tests)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestLocalAnalysisIncludesFacts:
    def test_local_analysis_attaches_shot_facts(self):
        from services.analysis_service import _perform_local_shot_analysis
        # Minimal shot + profile that exercises at least one executed stage.
        from test_fixtures import SAMPLE_SHOT_DATA, SAMPLE_PROFILE_DATA  # existing fixtures
        result = _perform_local_shot_analysis(SAMPLE_SHOT_DATA, SAMPLE_PROFILE_DATA)
        assert "shot_facts" in result
        assert "stages" in result["shot_facts"]
```

> If `test_fixtures` with those names does not exist, reuse whatever sample shot/profile the
> existing `_perform_local_shot_analysis` tests already use in `test_main.py` (search for
> `_perform_local_shot_analysis(`), and assert the same two keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestLocalAnalysisIncludesFacts -q`
Expected: FAIL — `KeyError: 'shot_facts'`

- [ ] **Step 3: Write minimal implementation**

In `apps/server/services/analysis_service.py`, add the import near the top with the other
service imports:

```python
from services.shot_facts import build_shot_facts
```

Find the `return` dict at the end of `_perform_local_shot_analysis` (the dict containing
`stage_analyses`, `weight_analysis`, `overall_metrics`, etc.) and add one key just before it
returns. Build the facts from the dict you are about to return:

```python
    analysis_result = {
        # ... existing keys (overall_metrics, weight_analysis, stage_analyses, ...) ...
    }
    analysis_result["shot_facts"] = build_shot_facts(analysis_result)
    return analysis_result
```

> If the function currently does `return { ... }` inline, refactor to assign to
> `analysis_result` first, then attach `shot_facts`, then `return analysis_result`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestLocalAnalysisIncludesFacts -q`
Expected: PASS

- [ ] **Step 5: Run the full analysis test group to ensure no regression**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -k "analysis or Analysis or shot or Shot" -q`
Expected: PASS (no failures)

- [ ] **Step 6: Commit**

```bash
git add apps/server/services/analysis_service.py apps/server/test_main.py
git commit -m "feat(analysis): attach shot_facts to local analysis output (server)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: ShotFacts parity — native (D1–D5)

The native local analysis (`DirectModeInterceptor.ts` ~2895–2943) emits the **same snake_case
field names** as the server (`stage_name`, `stage_type`, `execution_data.{start,end,avg}_pressure`,
`exit_trigger_result.triggered.type`, `exit_triggers[]`, `weight_analysis.{actual,target,deviation_percent}`).
Only difference: total time is `analysis.shot_summary.total_time` (not `overall_metrics`).
So `shotFacts.ts` is a near-direct port of `shot_facts.py`.

**Files:**
- Create: `apps/web/src/lib/shotFacts.ts`
- Test: `apps/web/src/lib/shotFacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/shotFacts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyTrigger, detectStall, detectChanneling, buildShotFacts } from './shotFacts'

describe('classifyTrigger (#423)', () => {
  it('weight is always targeted', () => {
    expect(classifyTrigger('pressure', 'weight', 2).kind).toBe('targeted')
  })
  it('time-only trigger is planned duration', () => {
    expect(classifyTrigger('flow', 'time', 1).kind).toBe('targeted')
  })
  it('time with other triggers is failsafe timeout', () => {
    const r = classifyTrigger('flow', 'time', 2)
    expect(r.kind).toBe('failsafe')
    expect(r.label.toLowerCase()).toContain('timeout')
  })
  it('flow control + pressure trigger is puck resistance', () => {
    expect(classifyTrigger('flow', 'pressure', 2).kind).toBe('targeted')
  })
  it('pressure control + flow-only trigger is planned transition', () => {
    expect(classifyTrigger('pressure', 'flow', 1).kind).toBe('targeted')
  })
  it('pressure control + flow with others is failsafe channeling', () => {
    expect(classifyTrigger('pressure', 'flow', 2).kind).toBe('failsafe')
  })
  it('pressure control + pressure trigger is threshold', () => {
    expect(classifyTrigger('pressure', 'pressure', 1).kind).toBe('targeted')
  })
  it('unknown combo returns unknown', () => {
    expect(classifyTrigger('power', 'weird', 1).kind).toBe('unknown')
  })
})

describe('detectStall / detectChanneling', () => {
  const ed = {
    duration: 10, weight_gain: 2, end_weight: 8,
    start_pressure: 1, end_pressure: 6, avg_pressure: 4, max_pressure: 6.5, min_pressure: 1,
    start_flow: 4, end_flow: 0.5, avg_flow: 2, max_flow: 4.5,
  }
  it('flags stall on time failsafe with low gain', () => {
    const stage = {
      stage_type: 'pressure',
      exit_triggers: [{ type: 'flow' }, { type: 'time' }],
      exit_trigger_result: { triggered: { type: 'time' } },
      execution_data: { ...ed, weight_gain: 0.3 },
    }
    expect(detectStall(stage).stalled).toBe(true)
  })
  it('no stall when weight trigger', () => {
    const stage = { stage_type: 'flow', exit_triggers: [{ type: 'weight' }], exit_trigger_result: { triggered: { type: 'weight' } }, execution_data: ed }
    expect(detectStall(stage).stalled).toBe(false)
  })
  it('flags channeling on pressure drop with flow rise', () => {
    expect(detectChanneling({ ...ed, start_pressure: 8, end_pressure: 3, start_flow: 1, end_flow: 5 }).channeling).toBe(true)
  })
  it('no channeling on stable stage', () => {
    expect(detectChanneling({ ...ed, start_pressure: 6, end_pressure: 6.2, start_flow: 2, end_flow: 2.1 }).channeling).toBe(false)
  })
})

describe('buildShotFacts', () => {
  it('classifies each stage and reads total time from shot_summary', () => {
    const analysis = {
      shot_summary: { total_time: 30 },
      weight_analysis: { actual: 36, target: 36, deviation_percent: 0 },
      stage_analyses: [{
        stage_name: 'Infusion', stage_type: 'pressure',
        exit_triggers: [{ type: 'weight' }],
        exit_trigger_result: { triggered: { type: 'weight' } },
        execution_data: { duration: 10, weight_gain: 2, end_weight: 8, start_pressure: 6, end_pressure: 6, avg_pressure: 6, max_pressure: 6, min_pressure: 6, start_flow: 2, end_flow: 2, avg_flow: 2, max_flow: 2 },
      }],
    }
    const facts = buildShotFacts(analysis)
    expect(facts.stages).toHaveLength(1)
    expect(facts.stages[0].trigger_class?.kind).toBe('targeted')
    expect(facts.total_time_s).toBe(30)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/shotFacts.test.ts`
Expected: FAIL — cannot find module `./shotFacts`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/shotFacts.ts`:

```typescript
/**
 * Deterministic shot-fact derivation (#423 + diagnostic signals).
 * TS parity of apps/server/services/shot_facts.py — keep thresholds identical.
 */

// Threshold constants — keep identical to shot_facts.py
export const STALL_MIN_WEIGHT_GAIN_G = 0.5
export const CHANNELING_PRESSURE_DROP_BAR = 1.5
export const CHANNELING_FLOW_RISE_MLS = 1.5

export type TriggerKind = 'targeted' | 'failsafe' | 'unknown'
export interface TriggerClass { kind: TriggerKind; label: string; reason: string }
export interface StallResult { stalled: boolean; weight_gain: number }
export interface ChannelingResult { channeling: boolean; pressure_drop: number; flow_rise: number }

interface ExecutionData {
  duration?: number; weight_gain?: number; end_weight?: number
  start_pressure?: number; end_pressure?: number; avg_pressure?: number; max_pressure?: number; min_pressure?: number
  start_flow?: number; end_flow?: number; avg_flow?: number; max_flow?: number
}
interface StageAnalysis {
  stage_name?: string; stage_type?: string; type?: string
  exit_triggers?: Array<{ type?: string }>
  exit_trigger_result?: { triggered?: { type?: string } | null } | null
  execution_data?: ExecutionData | null
  profile_target?: { target_value?: number } | unknown
}
export interface ShotFactStage {
  stage_name?: string
  reached: boolean
  control_mode?: string
  trigger_type?: string
  trigger_class?: TriggerClass
  stall?: StallResult
  channeling?: ChannelingResult
  curve_adherence?: { target: number; measured: number; delta: number } | null
}
export interface ShotFacts {
  stages: ShotFactStage[]
  phases: Array<{ stage_name?: string; phase: string; avg_pressure?: number; avg_flow?: number; weight_gain?: number }>
  weight: { actual?: number; target?: number; deviation_pct?: number }
  total_time_s?: number
}

const n = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)
const r2 = (v: number): number => Math.round(v * 100) / 100

export function classifyTrigger(stageControlMode: string, triggerType: string, totalTriggers: number): TriggerClass {
  if (triggerType === 'weight') {
    return { kind: 'targeted', label: 'Targeted (yield reached)', reason: 'Weight is the ultimate goal of the shot.' }
  }
  if (triggerType === 'time') {
    return totalTriggers === 1
      ? { kind: 'targeted', label: 'Targeted (planned duration)', reason: 'Time is the only trigger, so this is an intentional timed stage.' }
      : { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: 'Stage hit its time backstop before another target was reached.' }
  }
  if (stageControlMode === 'flow' && triggerType === 'pressure') {
    return { kind: 'targeted', label: 'Targeted (puck resistance achieved)', reason: 'Flow-controlled stage reached its intended pressure.' }
  }
  if (stageControlMode === 'pressure' && triggerType === 'flow') {
    return totalTriggers === 1
      ? { kind: 'targeted', label: 'Targeted (planned flow transition)', reason: 'Flow is the only trigger, so the transition is intentional.' }
      : { kind: 'failsafe', label: 'Failsafe (caught channeling or choking)', reason: 'Pressure-controlled stage exited on a flow backstop.' }
  }
  if (stageControlMode === 'pressure' && triggerType === 'pressure') {
    return { kind: 'targeted', label: 'Targeted (pressure threshold reached)', reason: 'Pressure-controlled stage reached its target pressure.' }
  }
  return { kind: 'unknown', label: 'Unknown', reason: 'Trigger/control-mode combination is not classified.' }
}

function stageControlMode(stage: StageAnalysis): string {
  const t = (stage.stage_type ?? stage.type ?? '').toLowerCase()
  if (t.includes('flow')) return 'flow'
  if (t.includes('pressure')) return 'pressure'
  return 'unknown'
}

export function detectStall(stage: StageAnalysis): StallResult {
  const trigType = stage.exit_trigger_result?.triggered?.type ?? ''
  const total = (stage.exit_triggers ?? []).length
  const gain = n(stage.execution_data?.weight_gain)
  const klass = classifyTrigger(stageControlMode(stage), trigType, total)
  const stalled = klass.kind === 'failsafe' && trigType === 'time' && gain < STALL_MIN_WEIGHT_GAIN_G
  return { stalled, weight_gain: r2(gain) }
}

export function detectChanneling(ed: ExecutionData): ChannelingResult {
  const pDrop = n(ed.start_pressure) - n(ed.end_pressure)
  const fRise = n(ed.end_flow) - n(ed.start_flow)
  return {
    channeling: pDrop >= CHANNELING_PRESSURE_DROP_BAR && fRise >= CHANNELING_FLOW_RISE_MLS,
    pressure_drop: r2(pDrop),
    flow_rise: r2(fRise),
  }
}

function buildPhases(stages: StageAnalysis[]): ShotFacts['phases'] {
  return stages
    .filter(s => s.execution_data)
    .map(s => {
      const ed = s.execution_data as ExecutionData
      const avgP = n(ed.avg_pressure)
      let phase: string
      if (avgP < 3.0) phase = 'pre-infusion'
      else if (n(ed.end_pressure) > n(ed.start_pressure)) phase = 'ramp'
      else if (n(ed.end_pressure) < n(ed.start_pressure)) phase = 'decline'
      else phase = 'peak'
      return { stage_name: s.stage_name, phase, avg_pressure: ed.avg_pressure, avg_flow: ed.avg_flow, weight_gain: ed.weight_gain }
    })
}

function curveAdherence(stage: StageAnalysis): ShotFactStage['curve_adherence'] {
  const pt = stage.profile_target as { target_value?: number } | undefined
  const target = pt?.target_value
  if (target == null) return null
  const mode = stageControlMode(stage)
  const measured = mode === 'pressure' ? stage.execution_data?.avg_pressure : stage.execution_data?.avg_flow
  if (measured == null) return null
  return { target, measured, delta: r2(measured - target) }
}

export function buildShotFacts(analysis: {
  stage_analyses?: StageAnalysis[]
  weight_analysis?: { actual?: number; target?: number; deviation_percent?: number }
  shot_summary?: { total_time?: number }
  overall_metrics?: { total_time?: number }
}): ShotFacts {
  const stages = analysis.stage_analyses ?? []
  const stagesOut: ShotFactStage[] = stages.map(s => {
    if (!s.execution_data) return { stage_name: s.stage_name, reached: false }
    const trigType = s.exit_trigger_result?.triggered?.type ?? ''
    const total = (s.exit_triggers ?? []).length
    return {
      stage_name: s.stage_name,
      reached: true,
      control_mode: stageControlMode(s),
      trigger_type: trigType,
      trigger_class: classifyTrigger(stageControlMode(s), trigType, total),
      stall: detectStall(s),
      channeling: detectChanneling(s.execution_data),
      curve_adherence: curveAdherence(s),
    }
  })
  const wa = analysis.weight_analysis ?? {}
  return {
    stages: stagesOut,
    phases: buildPhases(stages),
    weight: { actual: wa.actual, target: wa.target, deviation_pct: wa.deviation_percent },
    total_time_s: analysis.shot_summary?.total_time ?? analysis.overall_metrics?.total_time,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/shotFacts.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the native local analysis response**

In `DirectModeInterceptor.ts`, add the import at the top with the other lib imports:

```typescript
import { buildShotFacts } from '../../lib/shotFacts'
```

Find the `const analysis = { ... }` block (~2895) and attach facts right before `return jsonResponse(...)` at ~2944:

```typescript
          ;(analysis as Record<string, unknown>).shot_facts = buildShotFacts(analysis as Parameters<typeof buildShotFacts>[0])
          return jsonResponse({ status: 'success', analysis })
```

- [ ] **Step 6: Run the interceptor local-analysis tests to confirm no regression**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/interceptor`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/shotFacts.ts apps/web/src/lib/shotFacts.test.ts apps/web/src/services/interceptor/DirectModeInterceptor.ts
git commit -m "feat(analysis): add ShotFacts parity + wire into native local analysis

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Enrich the static analysis view with ShotFacts (Q3)

Render Targeted/Failsafe badges, stall + channeling flags, and curve-adherence deltas in the
existing local-analysis view. Implemented as a focused presentational subcomponent so it is
unit-testable in isolation, then mounted in `ShotDetail.tsx`.

**Files:**
- Modify: `apps/web/src/components/ShotHistoryView/types.ts` (add `shot_facts?` to `LocalAnalysisResult`)
- Create: `apps/web/src/components/ShotHistoryView/ShotFactsPanel.tsx`
- Create: `apps/web/src/components/ShotHistoryView/ShotFactsPanel.test.tsx`
- Modify: `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` (mount the panel)
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Add the type**

In `apps/web/src/components/ShotHistoryView/types.ts`, add the import and field:

```typescript
import type { ShotFacts } from '../../lib/shotFacts'
```

Then add one optional property to `LocalAnalysisResult` (after `profile_target_curves?`):

```typescript
  profile_target_curves?: ProfileTargetPoint[]
  shot_facts?: ShotFacts
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/ShotHistoryView/ShotFactsPanel.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShotFactsPanel } from './ShotFactsPanel'
import type { ShotFacts } from '../../lib/shotFacts'

// i18n is mocked globally in test/setup.ts to echo keys; assert on key fragments.
const facts: ShotFacts = {
  stages: [
    { stage_name: 'Infusion', reached: true, control_mode: 'pressure', trigger_type: 'weight',
      trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
      stall: { stalled: false, weight_gain: 30 },
      channeling: { channeling: false, pressure_drop: 0.1, flow_rise: 0.1 },
      curve_adherence: { target: 9, measured: 8.5, delta: -0.5 } },
    { stage_name: 'Decline', reached: true, control_mode: 'pressure', trigger_type: 'time',
      trigger_class: { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: '' },
      stall: { stalled: true, weight_gain: 0.2 },
      channeling: { channeling: true, pressure_drop: 3, flow_rise: 2 },
      curve_adherence: null },
  ],
  phases: [],
  weight: { actual: 36, target: 36, deviation_pct: 0 },
  total_time_s: 30,
}

describe('ShotFactsPanel', () => {
  it('renders a row per stage with its trigger label', () => {
    render(<ShotFactsPanel facts={facts} />)
    expect(screen.getByText('Infusion')).toBeInTheDocument()
    expect(screen.getByText('Decline')).toBeInTheDocument()
    expect(screen.getByText('Targeted (yield reached)')).toBeInTheDocument()
    expect(screen.getByText('Failsafe (timeout limit)')).toBeInTheDocument()
  })

  it('shows stall and channeling flags when present', () => {
    render(<ShotFactsPanel facts={facts} />)
    expect(screen.getByText('analysis.facts.stalled')).toBeInTheDocument()
    expect(screen.getByText('analysis.facts.channeling')).toBeInTheDocument()
  })

  it('renders nothing when facts has no reached stages', () => {
    const { container } = render(<ShotFactsPanel facts={{ ...facts, stages: [] }} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/components/ShotHistoryView/ShotFactsPanel.test.tsx`
Expected: FAIL — cannot find module `./ShotFactsPanel`

- [ ] **Step 4: Write the component**

Create `apps/web/src/components/ShotHistoryView/ShotFactsPanel.tsx`:

```typescript
import { useTranslation } from 'react-i18next'
import type { ShotFacts } from '../../lib/shotFacts'

interface Props {
  facts: ShotFacts
}

export function ShotFactsPanel({ facts }: Props) {
  const { t } = useTranslation()
  const reached = facts.stages.filter(s => s.reached)
  if (reached.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('analysis.facts.title')}</h3>
      <ul className="space-y-2">
        {reached.map((s, i) => (
          <li key={`${s.stage_name}-${i}`} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{s.stage_name}</span>
              {s.trigger_class && (
                <span
                  className={
                    'text-xs px-2 py-0.5 rounded-full ' +
                    (s.trigger_class.kind === 'targeted'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : s.trigger_class.kind === 'failsafe'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-muted text-muted-foreground')
                  }
                >
                  {s.trigger_class.label}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {s.stall?.stalled && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">{t('analysis.facts.stalled')}</span>
              )}
              {s.channeling?.channeling && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">{t('analysis.facts.channeling')}</span>
              )}
              {s.curve_adherence && Math.abs(s.curve_adherence.delta) >= 0.5 && (
                <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {t('analysis.facts.curveDelta', { delta: s.curve_adherence.delta })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/components/ShotHistoryView/ShotFactsPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Add i18n keys (all 6 locales)**

Add an `analysis.facts` block. If an `analysis` object already exists in a locale file, nest
`facts` inside it; otherwise add a top-level `analysis` object. Use these exact values:

`en`:
```json
"analysis": {
  "facts": {
    "title": "Stage signals",
    "stalled": "Stalled",
    "channeling": "Possible channeling",
    "curveDelta": "Curve Δ {{delta}}"
  }
}
```
`sv`:
```json
"analysis": { "facts": { "title": "Stegsignaler", "stalled": "Avstannade", "channeling": "Möjlig kanalbildning", "curveDelta": "Kurva Δ {{delta}}" } }
```
`de`:
```json
"analysis": { "facts": { "title": "Phasensignale", "stalled": "Stehengeblieben", "channeling": "Mögliches Channeling", "curveDelta": "Kurve Δ {{delta}}" } }
```
`es`:
```json
"analysis": { "facts": { "title": "Señales de fase", "stalled": "Estancado", "channeling": "Posible canalización", "curveDelta": "Curva Δ {{delta}}" } }
```
`fr`:
```json
"analysis": { "facts": { "title": "Signaux de phase", "stalled": "Bloqué", "channeling": "Chenalisation possible", "curveDelta": "Courbe Δ {{delta}}" } }
```
`it`:
```json
"analysis": { "facts": { "title": "Segnali di fase", "stalled": "Bloccato", "channeling": "Possibile canalizzazione", "curveDelta": "Curva Δ {{delta}}" } }
```

> If `analysis` already exists in a file, merge `facts` into it rather than adding a duplicate key.

- [ ] **Step 7: Mount the panel in ShotDetail**

In `apps/web/src/components/ShotHistoryView/ShotDetail.tsx`, add the import (near the other
component imports):

```typescript
import { ShotFactsPanel } from './ShotFactsPanel'
```

Find where the local `analysisResult` is rendered (the section that shows stage analyses /
weight analysis). Immediately above that section, render the panel when facts exist:

```tsx
{analysisResult?.shot_facts && <ShotFactsPanel facts={analysisResult.shot_facts} />}
```

> Place it inside the same conditional block guarded by `analysisResult` so it only appears
> once local analysis has loaded. Search for `analysisResult.weight_analysis` or
> `analysisResult.stage_analyses` to locate the render region.

- [ ] **Step 8: Verify locale parity + types + lint**

Run:
```bash
cd apps/web && bun run test:run -- --reporter=dot src/components/ShotHistoryView/ShotFactsPanel.test.tsx
npx tsc --noEmit 2>&1 | grep -v "useGenerationProgress.ts:94\|test/setup.ts:57" | grep "error TS" || echo "tsc baseline OK"
bunx eslint src/components/ShotHistoryView/ShotFactsPanel.tsx src/lib/shotFacts.ts
```
Expected: tests PASS, no new tsc errors, eslint clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/ShotHistoryView/types.ts apps/web/src/components/ShotHistoryView/ShotFactsPanel.tsx apps/web/src/components/ShotHistoryView/ShotFactsPanel.test.tsx apps/web/src/components/ShotHistoryView/ShotDetail.tsx apps/web/public/locales
git commit -m "feat(analysis): enrich static analysis view with ShotFacts badges + i18n

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Compass deterministic rules — both runtimes (D6)

Pure functions mapping compass taste coordinates (X: -1 sour ↔ 1 bitter, Y: -1 weak/thin ↔
1 strong/heavy) to concrete dial-in adjustment suggestions. Used deterministically (and later
fed to the AI in Phase 3). Mirrors the domain knowledge already in
`apps/server/prompt_builder.py:build_taste_context`.

**Files:**
- Create: `apps/server/services/compass_rules.py`
- Create: `apps/web/src/lib/compassRules.ts`
- Test: `apps/server/test_main.py` (`TestCompassRules`) + `apps/web/src/lib/compassRules.test.ts`

- [ ] **Step 1: Write the failing tests (both runtimes)**

Append to `apps/server/test_main.py`:

```python
class TestCompassRules:
    def test_sour_and_weak_suggests_finer_and_hotter(self):
        from services.compass_rules import compass_adjustments
        adj = compass_adjustments(taste_x=-0.8, taste_y=-0.6)
        kinds = {a["kind"] for a in adj}
        assert "grind_finer" in kinds
        assert any(a["kind"] in ("temp_up", "ratio_up", "dose_up") for a in adj)

    def test_bitter_and_strong_suggests_coarser_and_cooler(self):
        from services.compass_rules import compass_adjustments
        adj = compass_adjustments(taste_x=0.8, taste_y=0.7)
        kinds = {a["kind"] for a in adj}
        assert "grind_coarser" in kinds

    def test_centered_taste_returns_no_changes(self):
        from services.compass_rules import compass_adjustments
        assert compass_adjustments(taste_x=0.0, taste_y=0.0) == []
```

Create `apps/web/src/lib/compassRules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { compassAdjustments } from './compassRules'

describe('compassAdjustments (D6)', () => {
  it('sour + weak suggests finer and hotter', () => {
    const adj = compassAdjustments(-0.8, -0.6)
    const kinds = adj.map(a => a.kind)
    expect(kinds).toContain('grind_finer')
    expect(kinds.some(k => ['temp_up', 'ratio_up', 'dose_up'].includes(k))).toBe(true)
  })
  it('bitter + strong suggests coarser', () => {
    expect(compassAdjustments(0.8, 0.7).map(a => a.kind)).toContain('grind_coarser')
  })
  it('centered taste returns no changes', () => {
    expect(compassAdjustments(0, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run both to verify they fail**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestCompassRules -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.compass_rules'`

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/compassRules.test.ts`
Expected: FAIL — cannot find module `./compassRules`

- [ ] **Step 3: Implement (server)**

Create `apps/server/services/compass_rules.py`:

```python
"""Deterministic Espresso-Compass taste -> dial-in adjustment rules (D6).

X axis: -1 sour ... +1 bitter.   Y axis: -1 weak/thin ... +1 strong/heavy.
Mirrors apps/web/src/lib/compassRules.ts and the domain knowledge in
prompt_builder.build_taste_context. Pure function — no I/O.
"""

from __future__ import annotations

DEADBAND = 0.25  # within this radius of center, taste is considered balanced


def compass_adjustments(taste_x: float, taste_y: float) -> list[dict]:
    """Return ordered, concrete adjustment suggestions for the given taste vector."""
    adjustments: list[dict] = []

    # X axis — acidity/bitterness balance, primarily extraction yield.
    if taste_x <= -DEADBAND:  # too sour -> under-extracted -> extract more
        adjustments.append({"kind": "grind_finer", "axis": "x",
                            "reason": "Sour/acidic indicates under-extraction; grind finer to raise yield."})
        adjustments.append({"kind": "temp_up", "axis": "x",
                            "reason": "A few degrees hotter increases extraction of sweet/bitter compounds."})
    elif taste_x >= DEADBAND:  # too bitter -> over-extracted -> extract less
        adjustments.append({"kind": "grind_coarser", "axis": "x",
                            "reason": "Bitter/harsh indicates over-extraction; grind coarser to lower yield."})
        adjustments.append({"kind": "temp_down", "axis": "x",
                            "reason": "A few degrees cooler reduces harsh bitter extraction."})

    # Y axis — strength/body, primarily ratio/dose.
    if taste_y <= -DEADBAND:  # too weak/thin -> increase concentration
        adjustments.append({"kind": "ratio_up", "axis": "y",
                            "reason": "Weak/thin body; lower the brew ratio (less water per dose) for more concentration."})
        adjustments.append({"kind": "dose_up", "axis": "y",
                            "reason": "A larger dose increases strength and body."})
    elif taste_y >= DEADBAND:  # too strong/heavy -> dilute
        adjustments.append({"kind": "ratio_down", "axis": "y",
                            "reason": "Strong/heavy; raise the brew ratio (more water per dose) to lighten."})

    return adjustments
```

- [ ] **Step 4: Implement (native)**

Create `apps/web/src/lib/compassRules.ts`:

```typescript
/**
 * Deterministic Espresso-Compass taste -> dial-in adjustment rules (D6).
 * X: -1 sour ... +1 bitter.   Y: -1 weak/thin ... +1 strong/heavy.
 * TS parity of apps/server/services/compass_rules.py — keep DEADBAND identical.
 */

export const COMPASS_DEADBAND = 0.25

export type CompassAdjustmentKind =
  | 'grind_finer' | 'grind_coarser' | 'temp_up' | 'temp_down'
  | 'ratio_up' | 'ratio_down' | 'dose_up'

export interface CompassAdjustment {
  kind: CompassAdjustmentKind
  axis: 'x' | 'y'
  reason: string
}

export function compassAdjustments(tasteX: number, tasteY: number): CompassAdjustment[] {
  const adjustments: CompassAdjustment[] = []

  if (tasteX <= -COMPASS_DEADBAND) {
    adjustments.push({ kind: 'grind_finer', axis: 'x', reason: 'Sour/acidic indicates under-extraction; grind finer to raise yield.' })
    adjustments.push({ kind: 'temp_up', axis: 'x', reason: 'A few degrees hotter increases extraction of sweet/bitter compounds.' })
  } else if (tasteX >= COMPASS_DEADBAND) {
    adjustments.push({ kind: 'grind_coarser', axis: 'x', reason: 'Bitter/harsh indicates over-extraction; grind coarser to lower yield.' })
    adjustments.push({ kind: 'temp_down', axis: 'x', reason: 'A few degrees cooler reduces harsh bitter extraction.' })
  }

  if (tasteY <= -COMPASS_DEADBAND) {
    adjustments.push({ kind: 'ratio_up', axis: 'y', reason: 'Weak/thin body; lower the brew ratio (less water per dose) for more concentration.' })
    adjustments.push({ kind: 'dose_up', axis: 'y', reason: 'A larger dose increases strength and body.' })
  } else if (tasteY >= COMPASS_DEADBAND) {
    adjustments.push({ kind: 'ratio_down', axis: 'y', reason: 'Strong/heavy; raise the brew ratio (more water per dose) to lighten.' })
  }

  return adjustments
}
```

- [ ] **Step 5: Run both to verify they pass**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestCompassRules -q` → PASS
Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/compassRules.test.ts` → PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/services/compass_rules.py apps/web/src/lib/compassRules.ts apps/web/src/lib/compassRules.test.ts apps/server/test_main.py
git commit -m "feat(analysis): add deterministic compass adjustment rules (both runtimes)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Phase 1 complete.** Deterministic ShotFacts (D1–D5) + compass rules (D6) exist and are wired
into both local-analysis paths, with the static view enriched. No AI changes yet.

## Phase 2 — Upgraded AI Layer (K1–K5)

### Task 7: ANALYSIS_KNOWLEDGE + fact sheet — server (K1 + K2)

**Files:**
- Create: `apps/server/analysis_knowledge.py`
- Test: `apps/server/test_main.py` (`TestAnalysisKnowledge`)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestAnalysisKnowledge:
    def test_knowledge_constant_covers_trigger_classes(self):
        from analysis_knowledge import ANALYSIS_KNOWLEDGE
        assert "Targeted" in ANALYSIS_KNOWLEDGE
        assert "Failsafe" in ANALYSIS_KNOWLEDGE
        assert "channeling" in ANALYSIS_KNOWLEDGE.lower()

    def test_fact_sheet_renders_stage_classification(self):
        from analysis_knowledge import build_fact_sheet
        facts = {
            "stages": [{
                "stage_name": "Infusion", "reached": True, "control_mode": "pressure",
                "trigger_type": "weight",
                "trigger_class": {"kind": "targeted", "label": "Targeted (yield reached)", "reason": "x"},
                "stall": {"stalled": False, "weight_gain": 30.0},
                "channeling": {"channeling": False, "pressure_drop": 0.1, "flow_rise": 0.1},
                "curve_adherence": {"target": 9.0, "measured": 8.5, "delta": -0.5},
            }],
            "phases": [],
            "weight": {"actual": 36.0, "target": 36.0, "deviation_pct": 0.0},
            "total_time_s": 30.0,
        }
        sheet = build_fact_sheet(facts)
        assert "Infusion" in sheet
        assert "Targeted (yield reached)" in sheet
        assert "36" in sheet

    def test_fact_sheet_flags_stall_and_channeling(self):
        from analysis_knowledge import build_fact_sheet
        facts = {
            "stages": [{
                "stage_name": "Decline", "reached": True, "control_mode": "pressure",
                "trigger_type": "time",
                "trigger_class": {"kind": "failsafe", "label": "Failsafe (timeout limit)", "reason": "x"},
                "stall": {"stalled": True, "weight_gain": 0.2},
                "channeling": {"channeling": True, "pressure_drop": 3.0, "flow_rise": 2.0},
                "curve_adherence": None,
            }],
            "phases": [], "weight": {}, "total_time_s": 25.0,
        }
        sheet = build_fact_sheet(facts).lower()
        assert "stall" in sheet
        assert "channel" in sheet
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisKnowledge -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'analysis_knowledge'`

- [ ] **Step 3: Write the implementation**

Create `apps/server/analysis_knowledge.py`:

```python
"""Analysis-specific knowledge base + fact-sheet renderer (K1 + K2).

ANALYSIS_KNOWLEDGE is injected into the shot-analysis prompt (parallel to PROFILING_KNOWLEDGE)
so small models share the same reasoning framework. build_fact_sheet renders the deterministic
ShotFacts into compact prose that replaces the raw local-analysis JSON dump in the prompt.

Mirror of apps/web/src/services/ai/analysisKnowledge.ts — keep the two texts in sync.
"""

from __future__ import annotations

ANALYSIS_KNOWLEDGE = """\
You are reasoning about a single espresso extraction. Apply this framework:

EXIT TRIGGER CLASSIFICATION (critical — do not confuse intent with failure):
- A stage ends when one of its exit triggers fires. Classify each as Targeted or Failsafe:
  - Targeted: the stage reached the outcome it was designed for. Examples: a weight trigger
    (yield reached), a time trigger that is the stage's ONLY trigger (planned duration), a
    flow-controlled stage hitting its target pressure (puck resistance achieved), a
    pressure-controlled stage hitting target pressure, or a pressure-controlled stage whose
    ONLY trigger is flow (planned flow transition).
  - Failsafe: a backstop fired before the real target. Examples: a time trigger firing when
    OTHER triggers also exist (timeout), or a pressure-controlled stage exiting on a flow
    backstop when other triggers exist (caught channeling or choking).
- NEVER describe a Targeted exit as a problem. A short stage that hit its weight target is a
  correct, successful outcome — not "early termination".

DIAGNOSTIC SIGNALS:
- Stall: a stage exits on a time failsafe with negligible weight gain (< 0.5 g). Indicates the
  puck choked or flow collapsed. Suggest a coarser grind or revisiting the pressure target.
- Channeling: pressure falls while flow rises within the same stage. Indicates an uneven puck.
  Suggest distribution/puck-prep changes, not profile changes, as the first remedy.
- Curve adherence: when measured average diverges from the stage's target by a meaningful margin,
  the machine could not follow the profile — usually a grind/dose mismatch, not a profile flaw.

EXTRACTION THEORY:
- Sour/acidic => under-extraction => grind finer or raise temperature.
- Bitter/harsh => over-extraction => grind coarser or lower temperature.
- Weak/thin body => lower brew ratio (less water per dose) or larger dose.
- Strong/heavy => raise brew ratio.

DISCIPLINE:
- Only state facts supported by the data provided. Do NOT invent pressures, temperatures, weights,
  or events that are not in the fact sheet. If a value is unknown, say so.
- Prefer one or two high-confidence, specific, numeric recommendations over many vague ones.
"""


def _fmt_num(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def build_fact_sheet(facts: dict) -> str:
    """Render ShotFacts into compact prose for the LLM prompt (replaces raw JSON dump)."""
    lines: list[str] = ["### Deterministic Shot Facts (authoritative — trust over raw telemetry)"]

    weight = facts.get("weight") or {}
    lines.append(
        f"- Final weight: {_fmt_num(weight.get('actual'))} g "
        f"(target {_fmt_num(weight.get('target'))} g, "
        f"deviation {_fmt_num(weight.get('deviation_pct'))}%)."
    )
    lines.append(f"- Total shot time: {_fmt_num(facts.get('total_time_s'))} s.")

    lines.append("- Stage-by-stage:")
    for s in facts.get("stages", []):
        if not s.get("reached"):
            lines.append(f"  - {s.get('stage_name')}: not reached during this shot.")
            continue
        tc = s.get("trigger_class") or {}
        parts = [f"exit = {tc.get('label', 'Unknown')}"]
        stall = s.get("stall") or {}
        if stall.get("stalled"):
            parts.append(f"STALL (only {_fmt_num(stall.get('weight_gain'))} g gained)")
        chan = s.get("channeling") or {}
        if chan.get("channeling"):
            parts.append(
                f"CHANNELING (pressure -{_fmt_num(chan.get('pressure_drop'))} bar, "
                f"flow +{_fmt_num(chan.get('flow_rise'))} ml/s)"
            )
        ca = s.get("curve_adherence")
        if ca and abs(float(ca.get("delta", 0) or 0)) >= 0.5:
            parts.append(f"curve off-target by {_fmt_num(ca.get('delta'))}")
        lines.append(f"  - {s.get('stage_name')} [{s.get('control_mode')}]: " + "; ".join(parts) + ".")

    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisKnowledge -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/analysis_knowledge.py apps/server/test_main.py
git commit -m "feat(analysis): add ANALYSIS_KNOWLEDGE + fact-sheet renderer (server)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: ANALYSIS_KNOWLEDGE + fact sheet — native (K1 + K2)

**Files:**
- Create: `apps/web/src/services/ai/analysisKnowledge.ts`
- Test: `apps/web/src/services/ai/analysisKnowledge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/services/ai/analysisKnowledge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ANALYSIS_KNOWLEDGE, buildFactSheet } from './analysisKnowledge'
import type { ShotFacts } from '../../lib/shotFacts'

describe('ANALYSIS_KNOWLEDGE', () => {
  it('covers trigger classes + channeling', () => {
    expect(ANALYSIS_KNOWLEDGE).toContain('Targeted')
    expect(ANALYSIS_KNOWLEDGE).toContain('Failsafe')
    expect(ANALYSIS_KNOWLEDGE.toLowerCase()).toContain('channeling')
  })
})

describe('buildFactSheet', () => {
  const facts: ShotFacts = {
    stages: [
      { stage_name: 'Infusion', reached: true, control_mode: 'pressure', trigger_type: 'weight',
        trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
        stall: { stalled: false, weight_gain: 30 },
        channeling: { channeling: false, pressure_drop: 0.1, flow_rise: 0.1 },
        curve_adherence: { target: 9, measured: 8.5, delta: -0.5 } },
      { stage_name: 'Decline', reached: true, control_mode: 'pressure', trigger_type: 'time',
        trigger_class: { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: '' },
        stall: { stalled: true, weight_gain: 0.2 },
        channeling: { channeling: true, pressure_drop: 3, flow_rise: 2 },
        curve_adherence: null },
    ],
    phases: [],
    weight: { actual: 36, target: 36, deviation_pct: 0 },
    total_time_s: 30,
  }

  it('renders stage classifications and weight', () => {
    const sheet = buildFactSheet(facts)
    expect(sheet).toContain('Infusion')
    expect(sheet).toContain('Targeted (yield reached)')
    expect(sheet).toContain('36')
  })

  it('flags stall and channeling', () => {
    const sheet = buildFactSheet(facts).toLowerCase()
    expect(sheet).toContain('stall')
    expect(sheet).toContain('channel')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/ai/analysisKnowledge.test.ts`
Expected: FAIL — cannot find module `./analysisKnowledge`

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/services/ai/analysisKnowledge.ts`:

```typescript
/**
 * Analysis-specific knowledge base + fact-sheet renderer (K1 + K2).
 * Mirror of apps/server/analysis_knowledge.py — keep the two texts in sync.
 */
import type { ShotFacts } from '../../lib/shotFacts'

export const ANALYSIS_KNOWLEDGE = `You are reasoning about a single espresso extraction. Apply this framework:

EXIT TRIGGER CLASSIFICATION (critical — do not confuse intent with failure):
- A stage ends when one of its exit triggers fires. Classify each as Targeted or Failsafe:
  - Targeted: the stage reached the outcome it was designed for. Examples: a weight trigger
    (yield reached), a time trigger that is the stage's ONLY trigger (planned duration), a
    flow-controlled stage hitting its target pressure (puck resistance achieved), a
    pressure-controlled stage hitting target pressure, or a pressure-controlled stage whose
    ONLY trigger is flow (planned flow transition).
  - Failsafe: a backstop fired before the real target. Examples: a time trigger firing when
    OTHER triggers also exist (timeout), or a pressure-controlled stage exiting on a flow
    backstop when other triggers exist (caught channeling or choking).
- NEVER describe a Targeted exit as a problem. A short stage that hit its weight target is a
  correct, successful outcome — not "early termination".

DIAGNOSTIC SIGNALS:
- Stall: a stage exits on a time failsafe with negligible weight gain (< 0.5 g). Indicates the
  puck choked or flow collapsed. Suggest a coarser grind or revisiting the pressure target.
- Channeling: pressure falls while flow rises within the same stage. Indicates an uneven puck.
  Suggest distribution/puck-prep changes, not profile changes, as the first remedy.
- Curve adherence: when measured average diverges from the stage's target by a meaningful margin,
  the machine could not follow the profile — usually a grind/dose mismatch, not a profile flaw.

EXTRACTION THEORY:
- Sour/acidic => under-extraction => grind finer or raise temperature.
- Bitter/harsh => over-extraction => grind coarser or lower temperature.
- Weak/thin body => lower brew ratio (less water per dose) or larger dose.
- Strong/heavy => raise brew ratio.

DISCIPLINE:
- Only state facts supported by the data provided. Do NOT invent pressures, temperatures, weights,
  or events that are not in the fact sheet. If a value is unknown, say so.
- Prefer one or two high-confidence, specific, numeric recommendations over many vague ones.`

const fmtNum = (v: number | null | undefined): string =>
  v == null ? 'n/a' : (typeof v === 'number' ? `${+v.toFixed(2).replace(/\.?0+$/, '')}` : String(v))

export function buildFactSheet(facts: ShotFacts): string {
  const lines: string[] = ['### Deterministic Shot Facts (authoritative — trust over raw telemetry)']
  const w = facts.weight ?? {}
  lines.push(`- Final weight: ${fmtNum(w.actual)} g (target ${fmtNum(w.target)} g, deviation ${fmtNum(w.deviation_pct)}%).`)
  lines.push(`- Total shot time: ${fmtNum(facts.total_time_s)} s.`)
  lines.push('- Stage-by-stage:')
  for (const s of facts.stages) {
    if (!s.reached) {
      lines.push(`  - ${s.stage_name}: not reached during this shot.`)
      continue
    }
    const parts: string[] = [`exit = ${s.trigger_class?.label ?? 'Unknown'}`]
    if (s.stall?.stalled) parts.push(`STALL (only ${fmtNum(s.stall.weight_gain)} g gained)`)
    if (s.channeling?.channeling) {
      parts.push(`CHANNELING (pressure -${fmtNum(s.channeling.pressure_drop)} bar, flow +${fmtNum(s.channeling.flow_rise)} ml/s)`)
    }
    if (s.curve_adherence && Math.abs(s.curve_adherence.delta) >= 0.5) {
      parts.push(`curve off-target by ${fmtNum(s.curve_adherence.delta)}`)
    }
    lines.push(`  - ${s.stage_name} [${s.control_mode}]: ${parts.join('; ')}.`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/ai/analysisKnowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/ai/analysisKnowledge.ts apps/web/src/services/ai/analysisKnowledge.test.ts
git commit -m "feat(analysis): add ANALYSIS_KNOWLEDGE + fact-sheet renderer (native)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Wire knowledge + fact sheet + few-shot into server prompt (K1/K2/K3)

The route builds the prompt inline (`shots.py` ~991). Tests inspect the captured prompt via the
mocked model (`async_generate_content.call_args[0][0]`), matching the existing pattern.

**Files:**
- Modify: `apps/server/analysis_knowledge.py` (add `FEW_SHOT_ANALYSIS_EXAMPLE`)
- Modify: `apps/server/api/routes/shots.py` (~960–1000)
- Test: `apps/server/test_main.py` (`TestAnalysisPromptContent`)

- [ ] **Step 1: Add the few-shot constant**

Append to `apps/server/analysis_knowledge.py`:

```python
FEW_SHOT_ANALYSIS_EXAMPLE = """\
### Worked Example (format + reasoning reference — do not copy its numbers)
Facts: Pre-infusion [flow] exit = Targeted (planned duration); Ramp [pressure] exit = Targeted
(pressure threshold reached); Hold [pressure] exit = Targeted (yield reached); final weight 36 g
(target 36 g, deviation 0%); total time 28 s.

Good analysis excerpt:
## 1. Shot Performance
**What Happened:**
- Pre-infusion ran its planned duration, then pressure ramped cleanly to target.
- The hold stage ended exactly on the weight target — a correct, intentional finish.
**Assessment:** Good

Note how every claim maps to a fact, no values are invented, and the Targeted weight exit is
described as success, not "early termination".
"""
```

- [ ] **Step 2: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestAnalysisPromptContent:
    @patch("api.routes.shots.get_vision_model")
    def test_prompt_includes_knowledge_factsheet_fewshot(self, mock_get_model, client, sample_llm_request):
        """The analyze-llm prompt must carry ANALYSIS_KNOWLEDGE, the fact sheet, and the few-shot."""
        mock_model = MagicMock()
        mock_model.async_generate_content = AsyncMock(
            return_value=MagicMock(text="## 1. Shot Performance\n**What Happened:**\n- ok\n**Assessment:** Good")
        )
        mock_get_model.return_value = mock_model

        resp = client.post("/api/shots/analyze-llm", data=sample_llm_request)
        assert resp.status_code == 200
        prompt = mock_model.async_generate_content.call_args[0][0]
        assert "EXIT TRIGGER CLASSIFICATION" in prompt          # ANALYSIS_KNOWLEDGE
        assert "Deterministic Shot Facts" in prompt              # fact sheet
        assert "Worked Example" in prompt                        # few-shot
```

> Reuse the existing analyze-llm request fixture/helper already used by other analyze-llm tests
> in this file (search for `"/api/shots/analyze-llm"`). If none exists as a fixture, build the
> `data=` dict inline from the sample shot/profile those tests use, including `profile_name`,
> `shot_date`, `shot_filename`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisPromptContent -q`
Expected: FAIL — `assert 'EXIT TRIGGER CLASSIFICATION' in prompt` (knowledge not yet injected)

- [ ] **Step 4: Wire the prompt**

In `apps/server/api/routes/shots.py`, extend the existing knowledge import (line ~34):

```python
from prompt_builder import PROFILING_KNOWLEDGE  # existing
from analysis_knowledge import (
    ANALYSIS_KNOWLEDGE,
    FEW_SHOT_ANALYSIS_EXAMPLE,
    build_fact_sheet,
)
```

After `local_analysis = _perform_local_shot_analysis(...)` (~962), derive the fact sheet:

```python
        local_analysis = _perform_local_shot_analysis(shot_data, profile_data)
        shot_facts = local_analysis.get("shot_facts", {})
        fact_sheet = build_fact_sheet(shot_facts)
```

In the prompt f-string, add the analysis framework right after the existing PROFILING_KNOWLEDGE
block:

```python
## Expert Knowledge
{PROFILING_KNOWLEDGE}

## Analysis Framework
{ANALYSIS_KNOWLEDGE}
```

Replace the raw local-analysis JSON dump line (`{json.dumps(local_analysis, indent=2)}`) with the
fact sheet, keeping the surrounding explanatory text:

```python
## Shot Facts (digested)
{fact_sheet}
```

Add the few-shot just before the `Based on this data, provide a detailed expert analysis.` line:

```python
{FEW_SHOT_ANALYSIS_EXAMPLE}

---

Based on this data, provide a detailed expert analysis.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisPromptContent -q`
Expected: PASS

- [ ] **Step 6: Run analyze-llm regression group**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -k "llm or analyze" -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/analysis_knowledge.py apps/server/api/routes/shots.py apps/server/test_main.py
git commit -m "feat(analysis): inject knowledge + fact sheet + few-shot into server prompt

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Wire knowledge + fact sheet + few-shot + taste parity into native prompt (K1/K2/K3/K5)

The native DirectMode path (`DirectModeInterceptor.ts` ~3107) currently omits PROFILING_KNOWLEDGE
AND taste context, and dumps raw `localAnalysis` JSON. Add the analysis framework, fact sheet,
few-shot, and compass taste section to reach server parity.

**Files:**
- Modify: `apps/web/src/services/ai/analysisKnowledge.ts` (add `FEW_SHOT_ANALYSIS_EXAMPLE`)
- Modify: `apps/web/src/services/interceptor/DirectModeInterceptor.ts` (~3051–3140)
- Test: `apps/web/src/services/interceptor/analyzeLlmPrompt.test.ts`

- [ ] **Step 1: Add the few-shot constant (mirror server)**

Append to `apps/web/src/services/ai/analysisKnowledge.ts`:

```typescript
export const FEW_SHOT_ANALYSIS_EXAMPLE = `### Worked Example (format + reasoning reference — do not copy its numbers)
Facts: Pre-infusion [flow] exit = Targeted (planned duration); Ramp [pressure] exit = Targeted
(pressure threshold reached); Hold [pressure] exit = Targeted (yield reached); final weight 36 g
(target 36 g, deviation 0%); total time 28 s.

Good analysis excerpt:
## 1. Shot Performance
**What Happened:**
- Pre-infusion ran its planned duration, then pressure ramped cleanly to target.
- The hold stage ended exactly on the weight target — a correct, intentional finish.
**Assessment:** Good

Note how every claim maps to a fact, no values are invented, and the Targeted weight exit is
described as success, not "early termination".`
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/services/interceptor/analyzeLlmPrompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildAnalyzeLlmPrompt } from './analyzeLlmPrompt'
import type { ShotFacts } from '../../lib/shotFacts'

const facts: ShotFacts = {
  stages: [{ stage_name: 'Hold', reached: true, control_mode: 'pressure', trigger_type: 'weight',
    trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
    stall: { stalled: false, weight_gain: 30 },
    channeling: { channeling: false, pressure_drop: 0, flow_rise: 0 },
    curve_adherence: null }],
  phases: [], weight: { actual: 36, target: 36, deviation_pct: 0 }, total_time_s: 28,
}

describe('buildAnalyzeLlmPrompt', () => {
  it('includes knowledge, fact sheet, few-shot', () => {
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts, tasteContext: '',
    })
    expect(p).toContain('EXIT TRIGGER CLASSIFICATION')
    expect(p).toContain('Deterministic Shot Facts')
    expect(p).toContain('Worked Example')
  })
  it('includes taste section when compass taste provided', () => {
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts,
      tasteContext: '## Taste Goal\nUser wants less sour.',
    })
    expect(p).toContain('Taste Goal')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/interceptor/analyzeLlmPrompt.test.ts`
Expected: FAIL — cannot find module `./analyzeLlmPrompt`

- [ ] **Step 4: Extract the prompt into a testable builder**

Create `apps/web/src/services/interceptor/analyzeLlmPrompt.ts`. Move the long template string
that currently lives inline at `DirectModeInterceptor.ts:3107` into this pure function, adding the
three new sections. (Copy the EXISTING template body verbatim, then insert the new blocks marked
`// NEW`.)

```typescript
import { ANALYSIS_KNOWLEDGE, FEW_SHOT_ANALYSIS_EXAMPLE, buildFactSheet } from '../ai/analysisKnowledge'
import type { ShotFacts } from '../../lib/shotFacts'

export interface AnalyzeLlmPromptInput {
  profileName: string
  temperature: number | string | null
  targetWeight: number | string | null
  profileDescription: string
  profileVars: unknown[]
  cleanStages: unknown[]
  facts: ShotFacts
  tasteContext: string
}

export function buildAnalyzeLlmPrompt(input: AnalyzeLlmPromptInput): string {
  const { profileName, temperature, targetWeight, profileDescription, profileVars, cleanStages, facts, tasteContext } = input
  return `You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

## Analysis Framework
${ANALYSIS_KNOWLEDGE}

## Profile Being Used
Name: ${profileName}
Temperature: ${temperature ?? 'Not set'}°C
Target Weight: ${targetWeight ?? 'Not set'}g

### Profile Description
${profileDescription || 'No description provided - analyze the profile structure to understand intent.'}

### Profile Variables
${JSON.stringify(profileVars, null, 2)}

### Profile Stages
${JSON.stringify(cleanStages, null, 2)}

## Shot Facts (digested)
${buildFactSheet(facts)}
${tasteContext ? `\n${tasteContext}\n` : ''}
${FEW_SHOT_ANALYSIS_EXAMPLE}

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these section headers with the exact format shown (## followed by number, period, space, then title)
2. Each section MUST have the subsection headers shown (bold text with colon, like **What Happened:**)
3. ALL content under subsections MUST be bullet points starting with "- "
4. Keep bullet points concise (1-2 sentences max per bullet)
5. Do NOT add extra sections or subsections beyond what's specified

## 1. Shot Performance

**What Happened:**
- [Stage-by-stage description of the extraction]
- [Notable events: pressure spikes, flow restrictions, early/late stage exits]
- [Final weight accuracy relative to target]

**Assessment:** [Choose exactly one: Good / Acceptable / Needs Improvement / Problematic]

## 2. Root Cause Analysis

**Primary Factors:**
- [Most likely cause with brief explanation]

**Secondary Considerations:**
- [Other contributing factors]

## 3. Setup Recommendations

**Priority Changes:**
- [Most important change - be specific with numbers when possible]

**Additional Suggestions:**
- [Other tweaks to consider]

## 4. Profile Recommendations

**Recommended Adjustments:**
- [Specific profile changes: timing, triggers, targets]

**Reasoning:**
- [Why these changes would improve the shot]

## 5. Profile Design Observations

**Strengths:**
- [Well-designed aspects of this profile]

**Potential Improvements:**
- [Exit trigger or safety limit suggestions]

Focus on actionable insights. Be specific with numbers where possible.

---

INTERNAL INSTRUCTION — Structured Recommendations (do NOT include this heading in your response):

After your analysis sections, you MUST output a structured JSON block with specific, actionable profile variable recommendations.
Use EXACTLY this format — the markers are parsed programmatically:

RECOMMENDATIONS_JSON:
[
  {
    "variable": "<variable key from the profile>",
    "current_value": <current numeric value>,
    "recommended_value": <suggested numeric value>,
    "stage": "<stage name or 'global'>",
    "confidence": "<high|medium|low>",
    "reason": "<one-sentence explanation>"
  }
]
END_RECOMMENDATIONS_JSON

Rules: only include recommendations with a SPECIFIC numeric change; use actual variable keys; if none apply, output an empty array: RECOMMENDATIONS_JSON:\n[]\nEND_RECOMMENDATIONS_JSON`
}
```

> Keep the section bodies identical to the current inline template. The goal of this extraction is
> testability + the three NEW sections (Analysis Framework, Shot Facts, Worked Example) + taste.

- [ ] **Step 5: Call the builder from the interceptor**

In `DirectModeInterceptor.ts`, add imports:

```typescript
import { buildAnalyzeLlmPrompt } from './analyzeLlmPrompt'
import { buildTasteContext } from '../ai/prompts'
```

Replace the inline `const prompt = \`...\`` block (~3107–3228) with a call. Build the taste
context from the request's compass params if present (the analyze-llm POST body may include
`taste_x`, `taste_y`, `taste_descriptors` — parse like the server route does; default to empty):

```typescript
          const tasteX = form.get('taste_x') != null ? Number(form.get('taste_x')) : null
          const tasteY = form.get('taste_y') != null ? Number(form.get('taste_y')) : null
          const tasteDescriptors = String(form.get('taste_descriptors') ?? '')
            .split(',').map(s => s.trim()).filter(Boolean)
          const tasteContext = (tasteX != null && tasteY != null)
            ? buildTasteContext(tasteX, tasteY, tasteDescriptors)
            : ''

          const prompt = buildAnalyzeLlmPrompt({
            profileName: pName,
            temperature: shotProfile?.temperature ?? null,
            targetWeight: shotProfile?.final_weight ?? null,
            profileDescription,
            profileVars,
            cleanStages,
            facts: buildShotFacts(localAnalysis as Parameters<typeof buildShotFacts>[0]),
            tasteContext,
          })
```

> `buildShotFacts` is already imported from Task 4. If `localAnalysis` here does not already carry
> `shot_facts`, compute it inline as shown. Ensure `form` is the parsed FormData already in scope
> in this handler (it is used for profile/shot lookup nearby).

- [ ] **Step 6: Run tests + interceptor regression**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/interceptor/analyzeLlmPrompt.test.ts src/services/interceptor`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/ai/analysisKnowledge.ts apps/web/src/services/interceptor/analyzeLlmPrompt.ts apps/web/src/services/interceptor/analyzeLlmPrompt.test.ts apps/web/src/services/interceptor/DirectModeInterceptor.ts
git commit -m "feat(analysis): native prompt parity — knowledge, fact sheet, few-shot, compass taste

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Anti-hallucination / semantic validator — native (K4)

Add a fact-aware validator that rejects analyses contradicting the deterministic ShotFacts (e.g.
calling a Targeted weight exit an "early termination"). High-precision checks only — false
positives force needless regeneration. Wire into both native analysis paths with retry+repair
(DirectMode currently returns raw, unvalidated text).

**Files:**
- Modify: `apps/web/src/lib/analysisLint.ts` (add `validateAgainstFacts`)
- Test: `apps/web/src/lib/analysisLint.test.ts` (append)
- Modify: `apps/web/src/services/interceptor/DirectModeInterceptor.ts` (validate response ~3238)

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/analysisLint.test.ts` (create the file if it does not exist, importing
from `./analysisLint`):

```typescript
import { describe, it, expect } from 'vitest'
import { validateAgainstFacts } from './analysisLint'
import type { ShotFacts } from './shotFacts'

const factsTargetedWeight: ShotFacts = {
  stages: [{ stage_name: 'Hold', reached: true, control_mode: 'pressure', trigger_type: 'weight',
    trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
    stall: { stalled: false, weight_gain: 30 },
    channeling: { channeling: false, pressure_drop: 0, flow_rise: 0 },
    curve_adherence: null }],
  phases: [], weight: { actual: 36, target: 36, deviation_pct: 0 }, total_time_s: 28,
}

describe('validateAgainstFacts (K4)', () => {
  it('flags a targeted weight exit described as early termination', () => {
    const text = '## 1. Shot Performance\n- The hold stage terminated early before reaching its goal.'
    const r = validateAgainstFacts(text, factsTargetedWeight)
    expect(r.valid).toBe(false)
    expect(r.issues).toContain('mischaracterized-targeted-exit')
  })
  it('accepts analysis that frames the targeted exit as success', () => {
    const text = '## 1. Shot Performance\n- The hold stage ended exactly on the weight target, a correct finish.'
    expect(validateAgainstFacts(text, factsTargetedWeight).valid).toBe(true)
  })
  it('flags channeling claimed when no stage channeled', () => {
    const text = '## 2. Root Cause\n- Severe channeling caused the pressure to collapse.'
    const r = validateAgainstFacts(text, factsTargetedWeight)
    expect(r.issues).toContain('unsupported-channeling')
  })
  it('does not flag channeling when a stage actually channeled', () => {
    const facts: ShotFacts = { ...factsTargetedWeight, stages: [{ ...factsTargetedWeight.stages[0],
      channeling: { channeling: true, pressure_drop: 3, flow_rise: 2 } }] }
    const text = '- Channeling is evident from the pressure drop.'
    expect(validateAgainstFacts(text, facts).issues).not.toContain('unsupported-channeling')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisLint.test.ts`
Expected: FAIL — `validateAgainstFacts` is not exported

- [ ] **Step 3: Implement the validator**

Append to `apps/web/src/lib/analysisLint.ts`:

```typescript
import type { ShotFacts } from './shotFacts'

/** Phrases that frame a stage exit as a failure/early stop. */
const EARLY_EXIT_PATTERNS = [
  /terminat\w*\s+early/i,
  /\bearly\s+terminat/i,
  /ended?\s+(too\s+)?(early|prematurely)/i,
  /\bcut\s+short\b/i,
  /stopped?\s+before\s+reaching/i,
]
/** Phrases asserting channeling occurred. */
const CHANNELING_ASSERTION = /\bchannel(?:ing|ed|s)?\b/i
/** Phrases that negate channeling (so we don't flag "no channeling"). */
const CHANNELING_NEGATION = /\b(no|not|without|absence of|isn'?t|wasn'?t)\b[^.]{0,30}channel/i

/**
 * Reject analyses that contradict the deterministic ShotFacts. High precision:
 * only flags clear, well-supported contradictions.
 */
export function validateAgainstFacts(text: string, facts: ShotFacts): AnalysisLintResult {
  const issues: string[] = []
  const body = text ?? ''

  const hasTargetedWeightExit = facts.stages.some(
    s => s.reached && s.trigger_type === 'weight' && s.trigger_class?.kind === 'targeted',
  )
  if (hasTargetedWeightExit && EARLY_EXIT_PATTERNS.some(re => re.test(body))) {
    issues.push('mischaracterized-targeted-exit')
  }

  const anyChanneling = facts.stages.some(s => s.channeling?.channeling)
  if (!anyChanneling && CHANNELING_ASSERTION.test(body) && !CHANNELING_NEGATION.test(body)) {
    issues.push('unsupported-channeling')
  }

  return { valid: issues.length === 0, issues }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisLint.test.ts`
Expected: PASS

- [ ] **Step 5: Wire validation into DirectMode (retry once, then repair)**

In `DirectModeInterceptor.ts`, locate the analyze-llm response handling (~3231–3242) where it
currently returns `analysisText` raw. Replace with validate → retry → repair:

```typescript
          const analyzeProvider = getProviderForMethod('analyzeShot')
          const facts = buildShotFacts(localAnalysis as Parameters<typeof buildShotFacts>[0])
          const gen = async () => {
            const r = await retryWithBackoff(() => analyzeProvider.generateText({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            })) as { text?: string }
            return r.text ?? ''
          }
          let analysisText = await gen()
          let lint = lintShotAnalysis(analysisText)
          let factCheck = validateAgainstFacts(analysisText, facts)
          if (!lint.valid || !factCheck.valid) {
            analysisText = await gen()  // one retry
            lint = lintShotAnalysis(analysisText)
            factCheck = validateAgainstFacts(analysisText, facts)
          }
          if (!lint.valid) analysisText = repairShotAnalysis(analysisText)
          return jsonResponse({ status: 'success', llm_analysis: analysisText, cached: false })
```

Add the imports at the top of the file if not already present:

```typescript
import { lintShotAnalysis, repairShotAnalysis, validateAgainstFacts } from '../../lib/analysisLint'
```

- [ ] **Step 6: Run interceptor tests**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/services/interceptor src/lib/analysisLint.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/analysisLint.ts apps/web/src/lib/analysisLint.test.ts apps/web/src/services/interceptor/DirectModeInterceptor.ts
git commit -m "feat(analysis): add anti-hallucination validator + wire native retry/repair (K4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: Anti-hallucination validator — server (K4 parity)

**Files:**
- Create: `apps/server/services/analysis_validator.py`
- Modify: `apps/server/api/routes/shots.py` (validate `llm_analysis` after generation, ~1131)
- Test: `apps/server/test_main.py` (`TestAnalysisValidator`)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestAnalysisValidator:
    def _facts_targeted_weight(self):
        return {
            "stages": [{
                "stage_name": "Hold", "reached": True, "control_mode": "pressure",
                "trigger_type": "weight",
                "trigger_class": {"kind": "targeted", "label": "Targeted (yield reached)", "reason": ""},
                "stall": {"stalled": False, "weight_gain": 30.0},
                "channeling": {"channeling": False, "pressure_drop": 0.0, "flow_rise": 0.0},
                "curve_adherence": None,
            }],
            "phases": [], "weight": {"actual": 36.0, "target": 36.0, "deviation_pct": 0.0},
            "total_time_s": 28.0,
        }

    def test_flags_targeted_exit_called_early_termination(self):
        from services.analysis_validator import validate_against_facts
        text = "- The hold stage terminated early before reaching its goal."
        r = validate_against_facts(text, self._facts_targeted_weight())
        assert r["valid"] is False
        assert "mischaracterized-targeted-exit" in r["issues"]

    def test_accepts_success_framing(self):
        from services.analysis_validator import validate_against_facts
        text = "- The hold stage ended exactly on the weight target, a correct finish."
        assert validate_against_facts(text, self._facts_targeted_weight())["valid"] is True

    def test_flags_unsupported_channeling(self):
        from services.analysis_validator import validate_against_facts
        text = "- Severe channeling caused the pressure to collapse."
        assert "unsupported-channeling" in validate_against_facts(text, self._facts_targeted_weight())["issues"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisValidator -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.analysis_validator'`

- [ ] **Step 3: Implement (mirror of native)**

Create `apps/server/services/analysis_validator.py`:

```python
"""Anti-hallucination / semantic validator for shot-analysis output (K4 server parity).

Mirror of validateAgainstFacts in apps/web/src/lib/analysisLint.ts — keep rules identical.
High precision: only flag clear contradictions of the deterministic ShotFacts.
"""

from __future__ import annotations

import re

_EARLY_EXIT_PATTERNS = [
    re.compile(r"terminat\w*\s+early", re.I),
    re.compile(r"\bearly\s+terminat", re.I),
    re.compile(r"ended?\s+(too\s+)?(early|prematurely)", re.I),
    re.compile(r"\bcut\s+short\b", re.I),
    re.compile(r"stopped?\s+before\s+reaching", re.I),
]
_CHANNELING_ASSERTION = re.compile(r"\bchannel(?:ing|ed|s)?\b", re.I)
_CHANNELING_NEGATION = re.compile(r"\b(no|not|without|absence of|isn'?t|wasn'?t)\b[^.]{0,30}channel", re.I)


def validate_against_facts(text: str, facts: dict) -> dict:
    """Return {'valid': bool, 'issues': list[str]}."""
    issues: list[str] = []
    body = text or ""
    stages = facts.get("stages", [])

    has_targeted_weight_exit = any(
        s.get("reached")
        and s.get("trigger_type") == "weight"
        and (s.get("trigger_class") or {}).get("kind") == "targeted"
        for s in stages
    )
    if has_targeted_weight_exit and any(p.search(body) for p in _EARLY_EXIT_PATTERNS):
        issues.append("mischaracterized-targeted-exit")

    any_channeling = any((s.get("channeling") or {}).get("channeling") for s in stages)
    if not any_channeling and _CHANNELING_ASSERTION.search(body) and not _CHANNELING_NEGATION.search(body):
        issues.append("unsupported-channeling")

    return {"valid": len(issues) == 0, "issues": issues}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisValidator -q`
Expected: PASS

- [ ] **Step 5: Wire into the route (validate → one retry)**

In `apps/server/api/routes/shots.py`, add the import (~34 block):

```python
from services.analysis_validator import validate_against_facts
```

Replace the single generation (~1129–1131):

```python
        response = await model.async_generate_content(prompt)
        llm_analysis = response.text if response else "Analysis generation failed"
        if not validate_against_facts(llm_analysis, shot_facts)["valid"]:
            retry = await model.async_generate_content(prompt)
            retry_text = retry.text if retry else llm_analysis
            if validate_against_facts(retry_text, shot_facts)["valid"]:
                llm_analysis = retry_text
```

> `shot_facts` is already in scope from Task 9. The retry is best-effort — keep the first result
> if the retry is also invalid (no hard failure for the user).

- [ ] **Step 6: Run regression**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -k "Validator or llm or analyze" -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/services/analysis_validator.py apps/server/api/routes/shots.py apps/server/test_main.py
git commit -m "feat(analysis): add anti-hallucination validator + route retry (server K4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Phase 2 complete.** Both runtimes now share a knowledge base, a digested fact sheet, a few-shot
example, compass taste parity, and a fact-aware validator with retry/repair.

---

## Phase 3 — Espresso Compass UX (U1–U3)

The `analyze-llm` endpoint already accepts `taste_x` / `taste_y` / `taste_descriptors` (server
route + native interceptor wired in Task 10). Phase 3 adds the optional pre-analysis step that
collects taste, threads it into the request, persists it with the shot, and surfaces the
deterministic compass adjustments alongside the AI output.

### Task 13: Optional skippable compass step before analysis (U1)

Reuse the existing `TasteCompassInput` (`apps/web/src/components/TasteCompassInput.tsx`,
`TasteData` / `DEFAULT_TASTE_DATA`). A small gate component offers "Analyze with taste" or "Skip".

**Files:**
- Create: `apps/web/src/components/ShotHistoryView/AnalysisTasteGate.tsx`
- Create: `apps/web/src/components/ShotHistoryView/AnalysisTasteGate.test.tsx`
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ShotHistoryView/AnalysisTasteGate.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnalysisTasteGate } from './AnalysisTasteGate'
import { DEFAULT_TASTE_DATA } from '../TasteCompassInput'

describe('AnalysisTasteGate (U1)', () => {
  it('calls onSkip when the user skips', () => {
    const onSkip = vi.fn()
    render(<AnalysisTasteGate onAnalyze={vi.fn()} onSkip={onSkip} />)
    fireEvent.click(screen.getByTestId('taste-gate-skip'))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
  it('calls onAnalyze with current taste data', () => {
    const onAnalyze = vi.fn()
    render(<AnalysisTasteGate onAnalyze={onAnalyze} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByTestId('taste-gate-analyze'))
    expect(onAnalyze).toHaveBeenCalledWith(DEFAULT_TASTE_DATA)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/components/ShotHistoryView/AnalysisTasteGate.test.tsx`
Expected: FAIL — cannot find module `./AnalysisTasteGate`

- [ ] **Step 3: Implement the gate**

Create `apps/web/src/components/ShotHistoryView/AnalysisTasteGate.tsx`:

```typescript
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { TasteCompassInput, DEFAULT_TASTE_DATA, type TasteData } from '../TasteCompassInput'

interface Props {
  onAnalyze: (taste: TasteData) => void
  onSkip: () => void
  initialTaste?: TasteData
}

export function AnalysisTasteGate({ onAnalyze, onSkip, initialTaste }: Props) {
  const { t } = useTranslation()
  const [taste, setTaste] = useState<TasteData>(initialTaste ?? DEFAULT_TASTE_DATA)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t('analysis.taste.gateTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('analysis.taste.gateBody')}</p>
      </div>
      <TasteCompassInput value={taste} onChange={setTaste} />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" data-testid="taste-gate-skip" onClick={onSkip}>
          {t('analysis.taste.skip')}
        </Button>
        <Button data-testid="taste-gate-analyze" onClick={() => onAnalyze(taste)}>
          {t('analysis.taste.analyzeWithTaste')}
        </Button>
      </div>
    </div>
  )
}
```

> Verify the `Button` import path matches the project (`../ui/button`). If `TasteCompassInput`
> does not re-export `TasteData` / `DEFAULT_TASTE_DATA`, import them from their definition (they
> are exported from `TasteCompassInput.tsx` per the file's exports).

- [ ] **Step 4: Add i18n keys (all 6 locales)** — merge into the `analysis` object from Task 5.

`en`:
```json
"taste": {
  "gateTitle": "Refine with taste (optional)",
  "gateBody": "Tell the analysis how this shot tasted for sharper, taste-aware recommendations.",
  "skip": "Skip",
  "analyzeWithTaste": "Analyze with taste"
}
```
`sv`:
```json
"taste": { "gateTitle": "Förfina med smak (valfritt)", "gateBody": "Berätta hur koppen smakade för smakmedvetna rekommendationer.", "skip": "Hoppa över", "analyzeWithTaste": "Analysera med smak" }
```
`de`:
```json
"taste": { "gateTitle": "Mit Geschmack verfeinern (optional)", "gateBody": "Teile mit, wie der Shot geschmeckt hat, für geschmacksbewusste Empfehlungen.", "skip": "Überspringen", "analyzeWithTaste": "Mit Geschmack analysieren" }
```
`es`:
```json
"taste": { "gateTitle": "Refinar con el sabor (opcional)", "gateBody": "Indica a qué supo este shot para recomendaciones más precisas.", "skip": "Omitir", "analyzeWithTaste": "Analizar con el sabor" }
```
`fr`:
```json
"taste": { "gateTitle": "Affiner avec le goût (facultatif)", "gateBody": "Indiquez le goût de cette extraction pour des recommandations plus fines.", "skip": "Ignorer", "analyzeWithTaste": "Analyser avec le goût" }
```
`it`:
```json
"taste": { "gateTitle": "Affina con il gusto (facoltativo)", "gateBody": "Indica com'era il gusto per consigli più mirati.", "skip": "Salta", "analyzeWithTaste": "Analizza con il gusto" }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/components/ShotHistoryView/AnalysisTasteGate.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ShotHistoryView/AnalysisTasteGate.tsx apps/web/src/components/ShotHistoryView/AnalysisTasteGate.test.tsx apps/web/public/locales
git commit -m "feat(analysis): add optional compass taste gate before AI analysis (U1)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Thread taste into analysis, persist it, dual-feed deterministic adjustments (U2 + U3)

Wire the gate into `ShotDetail.tsx`: show it before triggering `analyze-llm`, pass taste into the
request, persist the last taste per shot, and render deterministic compass adjustments in the
static panel (dual feed).

**Files:**
- Create: `apps/web/src/lib/shotTasteStore.ts`
- Create: `apps/web/src/lib/shotTasteStore.test.ts`
- Modify: `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` (gate + request + persist)
- Modify: `apps/web/src/components/ShotHistoryView/ShotFactsPanel.tsx` (render adjustments)
- Modify: `apps/web/src/components/ShotHistoryView/ShotFactsPanel.test.tsx` (assert adjustments)

- [ ] **Step 1: Write the failing store test**

Create `apps/web/src/lib/shotTasteStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { saveShotTaste, loadShotTaste, shotTasteKey } from './shotTasteStore'

describe('shotTasteStore (U3)', () => {
  beforeEach(() => localStorage.clear())
  it('round-trips taste for a shot key', () => {
    const taste = { x: -0.5, y: 0.3, descriptors: ['sour'] }
    saveShotTaste('Prof', '2024-01-01', 'a.json', taste)
    expect(loadShotTaste('Prof', '2024-01-01', 'a.json')).toEqual(taste)
  })
  it('returns null when nothing stored', () => {
    expect(loadShotTaste('Prof', '2024-01-01', 'missing.json')).toBeNull()
  })
  it('builds a stable composite key', () => {
    expect(shotTasteKey('P', 'd', 'f')).toBe('shot-taste:P|d|f')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/shotTasteStore.test.ts`
Expected: FAIL — cannot find module `./shotTasteStore`

- [ ] **Step 3: Implement the store**

Create `apps/web/src/lib/shotTasteStore.ts`:

```typescript
/** Persist the compass taste a user supplied for a given shot (U3). */

export interface StoredTaste {
  x: number
  y: number
  descriptors: string[]
}

export function shotTasteKey(profileName: string, date: string, filename: string): string {
  return `shot-taste:${profileName}|${date}|${filename}`
}

export function saveShotTaste(profileName: string, date: string, filename: string, taste: StoredTaste): void {
  try {
    localStorage.setItem(shotTasteKey(profileName, date, filename), JSON.stringify(taste))
  } catch {
    // storage unavailable (private mode / quota) — non-critical
  }
}

export function loadShotTaste(profileName: string, date: string, filename: string): StoredTaste | null {
  try {
    const raw = localStorage.getItem(shotTasteKey(profileName, date, filename))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTaste
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && Array.isArray(parsed.descriptors)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/shotTasteStore.test.ts`
Expected: PASS

- [ ] **Step 5: Render deterministic adjustments in ShotFactsPanel (U2 dual-feed)**

Extend `ShotFactsPanel.test.tsx` with a new case:

```typescript
it('renders compass adjustments when taste is provided', () => {
  render(<ShotFactsPanel facts={facts} taste={{ x: -0.8, y: -0.6, descriptors: [] }} />)
  expect(screen.getByText('analysis.facts.adjustmentsTitle')).toBeInTheDocument()
  expect(screen.getByText(/grind_finer/i)).toBeInTheDocument()
})
```

Update `ShotFactsPanel.tsx` to accept an optional `taste` prop and render
`compassAdjustments(taste.x, taste.y)`:

```typescript
import { compassAdjustments } from '../../lib/compassRules'
import type { StoredTaste } from '../../lib/shotTasteStore'

interface Props {
  facts: ShotFacts
  taste?: StoredTaste | null
}

// inside the component, after the stages <ul>...</ul>:
{taste && (() => {
  const adj = compassAdjustments(taste.x, taste.y)
  if (adj.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-foreground">{t('analysis.facts.adjustmentsTitle')}</h4>
      <ul className="space-y-1">
        {adj.map((a, i) => (
          <li key={`${a.kind}-${i}`} className="text-xs text-muted-foreground">
            <span className="font-mono">{a.kind}</span> — {a.reason}
          </li>
        ))}
      </ul>
    </div>
  )
})()}
```

Add the `analysis.facts.adjustmentsTitle` key to all 6 locales (merge into the `facts` block):
- en: `"adjustmentsTitle": "Suggested adjustments"`
- sv: `"adjustmentsTitle": "Föreslagna justeringar"`
- de: `"adjustmentsTitle": "Vorgeschlagene Anpassungen"`
- es: `"adjustmentsTitle": "Ajustes sugeridos"`
- fr: `"adjustmentsTitle": "Ajustements suggérés"`
- it: `"adjustmentsTitle": "Regolazioni suggerite"`

- [ ] **Step 6: Wire the gate + persistence into ShotDetail**

In `ShotDetail.tsx`:

Add imports:
```typescript
import { AnalysisTasteGate } from './AnalysisTasteGate'
import { saveShotTaste, loadShotTaste, type StoredTaste } from '../../lib/shotTasteStore'
import type { TasteData } from '../TasteCompassInput'
```

Add state:
```typescript
const [showTasteGate, setShowTasteGate] = useState(false)
const [shotTaste, setShotTaste] = useState<StoredTaste | null>(null)
```

When the user requests AI analysis (the button that currently calls `handleLlmAnalysis`), first
show the gate instead. Replace the button's `onClick={handleLlmAnalysis}` with
`onClick={() => setShowTasteGate(true)}` and render the gate when `showTasteGate`:

```tsx
{showTasteGate && (
  <AnalysisTasteGate
    initialTaste={shotTaste ? { x: shotTaste.x, y: shotTaste.y, descriptors: shotTaste.descriptors } as TasteData : undefined}
    onSkip={() => { setShowTasteGate(false); handleLlmAnalysis(null) }}
    onAnalyze={(taste) => {
      const stored: StoredTaste = { x: taste.x, y: taste.y, descriptors: taste.descriptors ?? [] }
      setShotTaste(stored)
      if (selectedShot) saveShotTaste(profileName, selectedShot.date, selectedShot.filename, stored)
      setShowTasteGate(false)
      handleLlmAnalysis(stored)
    }}
  />
)}
```

Change `handleLlmAnalysis` to accept optional taste and append it to the request:
```typescript
const handleLlmAnalysis = async (taste: StoredTaste | null) => {
  // ... existing setup ...
  if (taste) {
    formData.append('taste_x', String(taste.x))
    formData.append('taste_y', String(taste.y))
    if (taste.descriptors.length) formData.append('taste_descriptors', taste.descriptors.join(','))
  }
  // ... existing fetch ...
}
```

Load any persisted taste when the shot changes (so re-analysis pre-fills it):
```typescript
useEffect(() => {
  if (selectedShot) setShotTaste(loadShotTaste(profileName, selectedShot.date, selectedShot.filename))
}, [selectedShot, profileName])
```

Pass `taste={shotTaste}` to the `<ShotFactsPanel ... />` mounted in Task 5.

> `TasteData` uses `x` / `y` / `descriptors` (confirm field names against
> `TasteCompassInput.tsx`'s `TasteData` interface; adjust the mapping if the axis fields differ).

- [ ] **Step 7: Run the affected tests + types + lint**

Run:
```bash
cd apps/web && bun run test:run -- --reporter=dot src/lib/shotTasteStore.test.ts src/components/ShotHistoryView/ShotFactsPanel.test.tsx src/components/ShotHistoryView/AnalysisTasteGate.test.tsx
npx tsc --noEmit 2>&1 | grep -v "useGenerationProgress.ts:94\|test/setup.ts:57" | grep "error TS" || echo "tsc baseline OK"
bunx eslint src/components/ShotHistoryView/ShotFactsPanel.tsx src/components/ShotHistoryView/ShotDetail.tsx src/lib/shotTasteStore.ts
```
Expected: tests PASS, no new tsc errors, eslint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/shotTasteStore.ts apps/web/src/lib/shotTasteStore.test.ts apps/web/src/components/ShotHistoryView/ShotFactsPanel.tsx apps/web/src/components/ShotHistoryView/ShotFactsPanel.test.tsx apps/web/src/components/ShotHistoryView/ShotDetail.tsx apps/web/public/locales
git commit -m "feat(analysis): thread compass taste into analysis, persist + dual-feed (U2/U3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Phase 3 complete.** The compass is an optional skippable pre-analysis step; taste is threaded
to the AI, persisted with the shot, and its deterministic adjustments are shown in the static view.

---

## Phase 4 — Format-Aware Linting (L1–L5)

Today's linter (`analysisLint.ts`) only catches degeneracy (empty/repetition/low-diversity).
Phase 4 makes it format-aware (required sections present), defines the section schema once per
runtime (single source consumed by both prompt + linter), ensures every analysis path runs the
full check (universal wiring), and adds a release-gate coverage-matrix test.

### Task 15: Single-source schema + format-aware structural lint — native (L1 + L2)

**Files:**
- Create: `apps/web/src/lib/analysisSchema.ts`
- Modify: `apps/web/src/lib/analysisLint.ts` (add `checkStructure`)
- Modify: `apps/web/src/lib/analysisLint.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/analysisLint.test.ts`:

```typescript
import { checkStructure } from './analysisLint'
import { REQUIRED_ANALYSIS_SECTIONS } from './analysisSchema'

describe('checkStructure (L1) + schema (L2)', () => {
  it('schema lists the five core sections', () => {
    expect(REQUIRED_ANALYSIS_SECTIONS).toContain('Shot Performance')
    expect(REQUIRED_ANALYSIS_SECTIONS.length).toBeGreaterThanOrEqual(5)
  })
  it('flags missing required sections', () => {
    const r = checkStructure('## 1. Shot Performance\n- ok')
    expect(r.valid).toBe(false)
    expect(r.issues).toContain('missing-sections')
  })
  it('accepts text containing all required section titles', () => {
    const text = REQUIRED_ANALYSIS_SECTIONS.map((s, i) => `## ${i + 1}. ${s}\n- content line here`).join('\n')
    expect(checkStructure(text).valid).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisLint.test.ts`
Expected: FAIL — cannot find module `./analysisSchema`

- [ ] **Step 3: Create the schema**

Create `apps/web/src/lib/analysisSchema.ts`:

```typescript
/**
 * Single source of truth for the shot-analysis section structure (L2).
 * Consumed by the prompt builders and the structural linter so the format the model is asked
 * to produce and the format we validate can never drift apart.
 * Mirror of apps/server/analysis_schema.py.
 */

export const REQUIRED_ANALYSIS_SECTIONS = [
  'Shot Performance',
  'Root Cause Analysis',
  'Setup Recommendations',
  'Profile Recommendations',
  'Profile Design Observations',
] as const

/** Optional taste section appended when compass taste is supplied. */
export const OPTIONAL_TASTE_SECTION = 'Taste-Based Recommendations'
```

- [ ] **Step 4: Add the structural check**

Append to `apps/web/src/lib/analysisLint.ts`:

```typescript
import { REQUIRED_ANALYSIS_SECTIONS } from './analysisSchema'

/**
 * Verify the analysis contains each required section title (L1). Matches on the title text so
 * it is robust to numbering/heading-level variations the model may introduce.
 */
export function checkStructure(text: string): AnalysisLintResult {
  const body = (text ?? '').toLowerCase()
  const missing = REQUIRED_ANALYSIS_SECTIONS.filter(s => !body.includes(s.toLowerCase()))
  return { valid: missing.length === 0, issues: missing.length ? ['missing-sections'] : [] }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisLint.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/analysisSchema.ts apps/web/src/lib/analysisLint.ts apps/web/src/lib/analysisLint.test.ts
git commit -m "feat(analysis): add single-source section schema + structural lint (native L1/L2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 16: Schema + structural lint parity + universal wiring — server & all native paths (L2/L1/L3)

**Files:**
- Create: `apps/server/analysis_schema.py`
- Modify: `apps/server/services/analysis_validator.py` (add `check_structure`, fold into `validate_against_facts` callers)
- Modify: `apps/server/api/routes/shots.py` (run structural check in the retry gate)
- Modify: `apps/web/src/services/interceptor/DirectModeInterceptor.ts` (add `checkStructure` to the gate)
- Test: `apps/server/test_main.py` (`TestAnalysisStructure`)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test_main.py`:

```python
class TestAnalysisStructure:
    def test_schema_lists_core_sections(self):
        from analysis_schema import REQUIRED_ANALYSIS_SECTIONS
        assert "Shot Performance" in REQUIRED_ANALYSIS_SECTIONS
        assert len(REQUIRED_ANALYSIS_SECTIONS) >= 5

    def test_check_structure_flags_missing_sections(self):
        from services.analysis_validator import check_structure
        r = check_structure("## 1. Shot Performance\n- ok")
        assert r["valid"] is False
        assert "missing-sections" in r["issues"]

    def test_check_structure_accepts_full_text(self):
        from analysis_schema import REQUIRED_ANALYSIS_SECTIONS
        from services.analysis_validator import check_structure
        text = "\n".join(f"## {i+1}. {s}\n- content" for i, s in enumerate(REQUIRED_ANALYSIS_SECTIONS))
        assert check_structure(text)["valid"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisStructure -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'analysis_schema'`

- [ ] **Step 3: Create the schema + structural check (server)**

Create `apps/server/analysis_schema.py`:

```python
"""Single source of truth for the shot-analysis section structure (L2).

Mirror of apps/web/src/lib/analysisSchema.ts — keep section titles identical.
"""

from __future__ import annotations

REQUIRED_ANALYSIS_SECTIONS = [
    "Shot Performance",
    "Root Cause Analysis",
    "Setup Recommendations",
    "Profile Recommendations",
    "Profile Design Observations",
]

OPTIONAL_TASTE_SECTION = "Taste-Based Recommendations"
```

Append to `apps/server/services/analysis_validator.py`:

```python
from analysis_schema import REQUIRED_ANALYSIS_SECTIONS


def check_structure(text: str) -> dict:
    """Verify the analysis contains each required section title (L1)."""
    body = (text or "").lower()
    missing = [s for s in REQUIRED_ANALYSIS_SECTIONS if s.lower() not in body]
    return {"valid": not missing, "issues": ["missing-sections"] if missing else []}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisStructure -q`
Expected: PASS

- [ ] **Step 5: Fold structural check into the route gate (server L3)**

In `apps/server/api/routes/shots.py`, update the import:

```python
from services.analysis_validator import validate_against_facts, check_structure
```

Extend the retry condition added in Task 12 so structure is also enforced:

```python
        response = await model.async_generate_content(prompt)
        llm_analysis = response.text if response else "Analysis generation failed"
        first_ok = (
            validate_against_facts(llm_analysis, shot_facts)["valid"]
            and check_structure(llm_analysis)["valid"]
        )
        if not first_ok:
            retry = await model.async_generate_content(prompt)
            retry_text = retry.text if retry else llm_analysis
            if (
                validate_against_facts(retry_text, shot_facts)["valid"]
                and check_structure(retry_text)["valid"]
            ):
                llm_analysis = retry_text
```

- [ ] **Step 6: Fold structural check into the native DirectMode gate (L3)**

In `DirectModeInterceptor.ts`, extend the import:

```typescript
import { lintShotAnalysis, repairShotAnalysis, validateAgainstFacts, checkStructure } from '../../lib/analysisLint'
```

In the validate→retry block from Task 11, include structure:

```typescript
          let analysisText = await gen()
          const ok = (txt: string) =>
            lintShotAnalysis(txt).valid && validateAgainstFacts(txt, facts).valid && checkStructure(txt).valid
          if (!ok(analysisText)) {
            const retry = await gen()
            if (ok(retry)) analysisText = retry
          }
          if (!lintShotAnalysis(analysisText).valid) analysisText = repairShotAnalysis(analysisText)
          return jsonResponse({ status: 'success', llm_analysis: analysisText, cached: false })
```

- [ ] **Step 7: Re-export structural check from analysisLint for the thin path**

`BrowserAIService.analyzeShot` (~147) already imports `lintShotAnalysis`/`repairShotAnalysis`
from `@/lib/analysisLint`. Add `checkStructure` to that path so the secondary native route is also
structure-aware. In `BrowserAIService.ts` line ~33:

```typescript
import { lintShotAnalysis, repairShotAnalysis, checkStructure } from '@/lib/analysisLint'
```

And update its validity check (~147):

```typescript
      const valid = (txt: string) => lintShotAnalysis(txt).valid && checkStructure(txt).valid
      if (!valid(text)) {
        const retry = await runAnalysis()
        text = valid(retry.text)
          ? retry.text
          : repairShotAnalysis(retry.text.length >= text.length ? retry.text : text)
      }
```

- [ ] **Step 8: Run regression both runtimes**

Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -k "Structure or Validator or llm or analyze" -q`
Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisLint.test.ts src/services/interceptor src/services/ai/BrowserAIService.test.ts`
Expected: PASS (if `BrowserAIService.test.ts` does not exist, omit it)

- [ ] **Step 9: Commit**

```bash
git add apps/server/analysis_schema.py apps/server/services/analysis_validator.py apps/server/api/routes/shots.py apps/web/src/services/interceptor/DirectModeInterceptor.ts apps/web/src/services/ai/BrowserAIService.ts apps/server/test_main.py
git commit -m "feat(analysis): universal structural lint wiring across all paths (L1/L2/L3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 17: Release-gate coverage matrix + full verification (L5)

A single test enumerates each runtime × check so the parity contract is explicit and a future
regression (e.g. removing the validator from one path) fails loudly.

**Files:**
- Create: `apps/web/src/lib/analysisCoverage.test.ts`
- Test (server): `apps/server/test_main.py` (`TestAnalysisCoverageMatrix`)

- [ ] **Step 1: Write the native coverage test**

Create `apps/web/src/lib/analysisCoverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as lint from './analysisLint'

describe('analysis coverage matrix (L5, native)', () => {
  it('exposes degeneracy, structural, and fact-aware checks', () => {
    expect(typeof lint.lintShotAnalysis).toBe('function')
    expect(typeof lint.checkStructure).toBe('function')
    expect(typeof lint.validateAgainstFacts).toBe('function')
    expect(typeof lint.repairShotAnalysis).toBe('function')
  })
})
```

- [ ] **Step 2: Write the server coverage test**

Append to `apps/server/test_main.py`:

```python
class TestAnalysisCoverageMatrix:
    def test_server_exposes_all_analysis_checks(self):
        from services import analysis_validator as v
        assert callable(v.validate_against_facts)
        assert callable(v.check_structure)
        from analysis_knowledge import build_fact_sheet, ANALYSIS_KNOWLEDGE  # noqa: F401
        from services.shot_facts import build_shot_facts, classify_trigger  # noqa: F401
        from services.compass_rules import compass_adjustments  # noqa: F401
```

- [ ] **Step 3: Run both coverage tests**

Run: `cd apps/web && bun run test:run -- --reporter=dot src/lib/analysisCoverage.test.ts`
Run: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py::TestAnalysisCoverageMatrix -q`
Expected: PASS

- [ ] **Step 4: Full verification (both runtimes)**

Run:
```bash
cd apps/web && bun run test:run -- --reporter=dot
npx tsc --noEmit 2>&1 | grep -v "useGenerationProgress.ts:94\|test/setup.ts:57" | grep "error TS" || echo "tsc baseline OK"
bun run build
bunx eslint . 2>&1 | tail -5
```
Then:
```bash
cd ../server && TEST_MODE=true .venv/bin/python -m pytest -q
.venv/bin/ruff check . && .venv/bin/black --check services/shot_facts.py services/compass_rules.py services/analysis_validator.py analysis_knowledge.py analysis_schema.py api/routes/shots.py
```
Expected: web suite green, tsc baseline only (2), build OK, eslint 0 errors; server suite green, ruff + black clean on the new/modified files.

- [ ] **Step 5: i18n parity check**

Run the repo's locale-parity test (the one that asserts equal key counts across locales — search
`featureParity.test.ts` or an i18n test):
```bash
cd apps/web && bun run test:run -- --reporter=dot src/lib/featureParity.test.ts
```
Expected: PASS (all 6 locales have the new `analysis.*` keys).

- [ ] **Step 6: Final commit**

```bash
git add apps/web/src/lib/analysisCoverage.test.ts apps/server/test_main.py
git commit -m "test(analysis): add release-gate coverage matrix for both runtimes (L5)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Phase 4 complete.** All analysis paths run degeneracy + structural + fact-aware validation from
a single-source schema, with an explicit coverage matrix guarding parity.

---

## Done-When

- D1–D6 deterministic ShotFacts exist in both runtimes with identical thresholds and table-driven
  #423 classification tests.
- The static analysis view shows Targeted/Failsafe badges, stall/channeling flags, curve deltas,
  and (when taste supplied) deterministic compass adjustments.
- Both AI prompts carry ANALYSIS_KNOWLEDGE, the digested fact sheet (replacing raw JSON), a
  few-shot example, and compass taste parity.
- Every analysis path (server route, native DirectMode, native BrowserAIService) runs degeneracy +
  structural + fact-aware validation with retry/repair, from a single-source section schema.
- The compass is an optional, skippable pre-analysis step; taste persists per shot and feeds both
  the AI and deterministic rules.
- Full web + server suites green; tsc baseline (2) unchanged; lint 0 errors; build OK; ruff/black
  clean on touched files; 6-locale i18n parity intact.
