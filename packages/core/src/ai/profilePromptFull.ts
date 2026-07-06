export const PROFILING_KNOWLEDGE = `ESPRESSO PROFILING GUIDE:

## Core Concepts
- Flow Rate: Higher = acidity/clarity, Lower = body/sweetness
- Pressure: Creates texture/mouthfeel/crema. High pressure risks channeling
- Temperature: Light roasts 92-96°C, Medium 90-93°C, Dark 82-90°C

## Four-Phase Structure
1. **Pre-infusion**: Flow 2-4 ml/s, pressure limit ~2 bar
2. **Bloom** (optional): Zero flow, 0.5-1.5 bar, 5-30s for fresh coffee
3. **Infusion**: Ramp to 6-9 bar pressure or 1.5-3 ml/s flow
4. **Taper**: Decline pressure/flow over final 20-30% of yield

## Blueprints
- **Classic Lever** (medium-dark): Pre-infuse→9 bar→taper 9→5 bar. Ratio 1:2
- **Turbo** (light): Pre-infuse→6 bar→taper 6→3 bar. Ratio 1:3. Fast, bright
- **Allongé/Soup** (very light): Pre-wet→high flow 8 ml/s. Ratio 1:4. Tea-like
- **Bloom & Extract** (very fresh): Pre-infuse→20s bloom→8 bar→taper 8→4 bar

## Troubleshooting
- Sour/thin → increase pressure, extend extraction, raise temp
- Bitter/astringent → lower pressure, taper earlier, lower temp
- Gushing → grind finer, reduce pre-infusion flow
- Choking → grind coarser, add bloom, increase initial pressure

## Control Strategy
- Flow-controlled: Adapts to puck resistance, forgiving
- Pressure-controlled: Traditional, needs precise grind
- Hybrid (recommended): Pressure + flow limits, or flow + pressure limits

## Best Practices
- Gentle pressure ramps (3-4s) prevent channeling
- Keep profiles to 3-4 stages (5-6 max)
- Pre-infusion: 5-10% of yield. Infusion: 60-75%. Taper: 20-30%
- Multiple exit triggers (primary + time backup) for safety
- dynamics points x-axis ALWAYS relative to stage start

## Pre-infusion Saturation Rules (#420) — use NATIVE machine triggers
The machine only honors native exit trigger types ("weight", "pressure", "flow", "time"). Implement the intent below with those native types — do NOT emit app-only pseudo triggers.
- Dose/water correlation → native WEIGHT trigger: a puck needs ~2× its dose in water to fully saturate (18g dose → ~36ml). Add a weight exit trigger at value ≈ 2 × dose (">=") computed from the actual dose.
- Pressure rise → native PRESSURE trigger: as the puck saturates, pressure climbs — add a pressure exit trigger at a low threshold (~2 bar, ">=").
- Always pair both with a native TIME safety backup; whichever fires first ends pre-infusion.

## Anti-Patterns
❌ Single exit trigger without time backup
❌ Exact match triggers — use >= comparison
❌ >5-6 stages — overcomplicated
❌ No safety timeouts
❌ Sudden pressure jumps — use 3+ second ramps
❌ Recommending weight exit triggers for the overall profile or final stage — all Meticulous profiles already have an automatic weight-based exit trigger handled by the machine firmware

`
