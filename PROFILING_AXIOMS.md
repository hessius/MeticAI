# Espresso Profiling Axioms

Reference knowledge base for MeticAI's espresso profile generation.

---

## Extraction Principles

- **Flow drives extraction, pressure is a consequence.** The rate of water delivery is the primary control; pressure results from flow meeting puck resistance.
- **Higher flow → acidity & clarity.** Faster water highlights brightness (good for light roasts).
- **Lower flow → body & sweetness.** Slower water increases contact time and dissolved solids.
- **Temperature controls solubility.** Higher temps extract less-soluble compounds (light roasts need 92–96 °C); lower temps prevent over-extraction (dark roasts: 82–90 °C).
- **The puck is dynamic.** Resistance changes as the puck saturates, swells, and erodes — profiles must adapt.
- **Extraction is non-linear.** Acids extract first, then sugars, then bitter compounds. Profiling controls which make it into the cup.

## Pre-infusion & Blooming

- **Goal: uniform saturation.** Gentle, low-flow (2–4 ml/s) and low-pressure (< 2 bar) prevents channeling.
- **Exit on a cue, not a timer.** End pre-infusion when first drops appear or a target volume is reached.
- **Blooming manages CO₂.** A zero-flow dwell after wetting lets fresh coffee off-gas (5–30 s depending on freshness).

## Stage-Based Profiling

- **Pre-infusion sets the foundation.** A flawed pre-infusion cannot be corrected later.
- **Infusion extracts core flavors.** Main phase at 6–9 bar or 1.5–3 ml/s develops body, sweetness, and acidity.
- **Tapering minimizes bitterness.** Gradually reducing pressure/flow in the final third prevents harsh, astringent compounds.

## Exit Triggers

- **Never rely on a single trigger.** Combine a primary target (weight) with a safety (time).
- **Use `>=` comparisons.** Avoids unreliable exact-match triggers.
- **Weight is the gold standard.** More accurate than time or volume for consistency.
- **Pre-infusion exits should be puck-feedback based.** Use pressure, flow, or weight thresholds.

## Pressure & Flow Profiling

- **Gentle ramps prevent channeling.** Ramp to peak over 3–4 s so the puck can settle.
- **Flow control is more adaptive.** Machine compensates for puck resistance changes automatically.
- **Pressure control gives precise texture.** Direct mouthfeel/crema control, but requires a perfectly dialed grind.
- **Hybrid approach (flow + pressure limit) is often best.**

## Common Patterns

| Pattern | Description | Best For |
|---------|-------------|----------|
| Classic Lever | Pre-infuse → 9-bar hold → taper | Medium-dark roasts, chocolate/caramel notes |
| Turbo Shot | High-flow, low-pressure (6 ml/s, 6 bar) | Light roasts, bright & clear |
| Slayer | Long low-flow pre-infusion → ramp to full pressure | Light roasts, maximizing sweetness |
| Allongé | Very long flow-only extraction | Ultra-light, tea-like clarity |
| Bloom & Hold | Bloom phase → steady extraction | Very fresh, gassy coffees |

## Roast Level Guidelines

- **Light roasts need more energy:** higher temps, longer contact time, and/or longer ratios.
- **Dark roasts are highly soluble:** lower temps, shorter extraction, gentler pressure, declining profiles.
- **Match pre-infusion to roast:** longer/gentler for light, shorter for dark.

## Dose, Yield & Ratio

| Style | Ratio | Character |
|-------|-------|-----------|
| Ristretto | 1:1 – 1:1.5 | Concentrated, intense, heavy body |
| Normale | 1:2 – 1:2.5 | Balanced starting point |
| Lungo | 1:3+ | Dilute, can be sweeter if controlled |

- Adjust ratio to tune: longer → more sweetness/clarity; shorter → more body/texture.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sour | Under-extracted | Grind finer, increase yield, raise temperature |
| Bitter | Over-extracted | Grind coarser, decrease yield, lower temperature |
| Gusher (too fast) | Grind too coarse | Grind finer, reduce pre-infusion flow |
| Choked (too slow) | Grind too fine | Grind coarser, add bloom phase |

## Variables

- **Variables make profiles adaptable.** Define `$target_flow`, `$final_weight`, `$max_pressure` as parameters.
- **Variable types must match control types** (flow variable for flow controls, pressure variable for pressure controls).
- **Conditional logic:** `IF pressure_at_flow > 8 bar THEN reduce peak to 8.5 bar` — adapts to different coffees automatically.

---

*Consolidated from expert community knowledge and practical experience with the Meticulous espresso machine.*
