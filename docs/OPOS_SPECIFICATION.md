# Open Pour Over Specification (OPOS) v1.1

**Status:** Proposed | **Version:** 1.1.0 | **Author:** Gemini / Jesper Hessius

## Problem Statement

Current manual brewing recipes are stored in non-standardized text blocks, leading to inconsistent extraction results across apps, devices, and communities. This specification proposes a simplified, machine-readable JSON schema to describe gravity-based coffee brewing protocols.

### Goals

1. **Interoperability** — Enable recipe sharing between apps (Beanconqueror, Visualizer, MeticAI)
2. **Machine-readability** — Allow smart scales and brewing assistants to guide users through recipes
3. **Simplicity** — Focus on primary brewing variables; avoid over-specification

### Key Changes in v1.1

- **Reduced Complexity:** Removed `kettle_spout` and `water_tds` to focus on primary brewing variables
- **Optionality:** Fields such as `filter_type`, `grind_microns`, and `valve_state` are now optional
- **Dripper Logic:**
  - `dripper`: Defines the specific equipment used for the current recipe instance (model/material)
  - `compatibility`: A metadata array listing other drippers known to work with this protocol
- **Data Deduplication:** `coffee_g` and `water_g` are the physical constraints; `ratio` is moved to metadata for UI display only
- **Enhanced Metadata:** Added `description` and `profile_image` (URI string) for better library integration
- **Visualizer Hints:** Enum added to assist charting engines in rendering "staircase" (pulse) vs "ramp" (continuous pour) curves

---

## Technical Specification

### Schema Definition

```json
{
  "version": "1.1.0",
  "metadata": {
    "name": "Recipe Name",
    "author": "Author Name",
    "description": "Short summary of the profile flavor and goals.",
    "profile_image": "https://example.com/image.png",
    "compatibility": ["V60", "April", "Origami"],
    "visualizer_hint": "pulse_block"
  },
  "equipment": {
    "dripper": {
      "model": "V60",
      "material": "Plastic"
    },
    "filter_type": "Abaca"
  },
  "ingredients": {
    "coffee_g": 15.0,
    "water_g": 250.0,
    "grind_setting": "Medium-Fine",
    "grind_microns": 600
  },
  "protocol": [
    {
      "step": 1,
      "action": "bloom",
      "water_g": 45,
      "duration_s": 45,
      "notes": "Saturate grounds evenly"
    },
    {
      "step": 2,
      "action": "pour",
      "water_g": 205,
      "duration_s": 90,
      "flow_rate": "steady",
      "notes": "Continuous center pour"
    }
  ]
}
```

### Field Definitions

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `version` | string | Yes | Schema version (semver) |
| `metadata.name` | string | Yes | Human-readable recipe name |
| `metadata.author` | string | No | Recipe creator |
| `metadata.description` | string | No | Flavor notes and goals |
| `metadata.profile_image` | string (URI) | No | Preview image URL |
| `metadata.compatibility` | string[] | No | Compatible dripper models |
| `metadata.visualizer_hint` | enum | No | `pulse_block` or `linear_ramp` |
| `equipment.dripper.model` | string | Yes | Dripper model name |
| `equipment.dripper.material` | string | No | Plastic, Ceramic, Glass, Metal |
| `equipment.filter_type` | string | No | Filter material (Abaca, Paper, Metal) |
| `ingredients.coffee_g` | number | Yes | Coffee dose in grams |
| `ingredients.water_g` | number | Yes | Total water in grams |
| `ingredients.grind_setting` | string | Yes | Descriptive grind (Coarse, Medium-Fine, etc.) |
| `ingredients.grind_microns` | number | No | Precise grind size in microns |
| `protocol` | array | Yes | Ordered list of brewing steps |

### Protocol Step Schema

```json
{
  "step": 1,
  "action": "bloom | pour | wait | swirl | stir",
  "water_g": 45,
  "duration_s": 45,
  "valve_state": "open | closed",
  "flow_rate": "slow | steady | fast",
  "notes": "Optional guidance text"
}
```

**Notes:**

- `ratio` is derived mathematically as `water_g / coffee_g`. Stored in metadata only to prevent data mismatch errors.
- `valve_state` is optional; only relevant for hybrid brewers like the Hario Switch.
- `visualizer_hint` directs the UI to render discrete steps (`pulse_block`) or smooth weight curves (`linear_ramp`).

---

## Example Recipes

### 1. Tetsu Kasuya 4:6 Method

*Optimized for coarse grind and high clarity.*

```json
{
  "metadata": {
    "name": "Tetsu Kasuya 4:6",
    "author": "Tetsu Kasuya",
    "description": "Adjust sweetness with first 40%; strength with final 60%.",
    "visualizer_hint": "pulse_block"
  },
  "equipment": {
    "dripper": { "model": "V60", "material": "Ceramic" }
  },
  "ingredients": {
    "coffee_g": 20.0,
    "water_g": 300.0,
    "grind_setting": "Coarse"
  },
  "protocol": [
    { "step": 1, "action": "pour", "water_g": 60, "duration_s": 45, "notes": "First pour (sweetness)" },
    { "step": 2, "action": "wait", "duration_s": 45 },
    { "step": 3, "action": "pour", "water_g": 60, "duration_s": 45, "notes": "Second pour (sweetness)" },
    { "step": 4, "action": "wait", "duration_s": 45 },
    { "step": 5, "action": "pour", "water_g": 60, "duration_s": 45, "notes": "Third pour (strength)" },
    { "step": 6, "action": "wait", "duration_s": 45 },
    { "step": 7, "action": "pour", "water_g": 60, "duration_s": 45, "notes": "Fourth pour (strength)" },
    { "step": 8, "action": "wait", "duration_s": 45 },
    { "step": 9, "action": "pour", "water_g": 60, "duration_s": 45, "notes": "Fifth pour (strength)" }
  ]
}
```

### 2. James Hoffmann V2 (1-Cup V60)

*Emphasis on thermal mass and uniform saturation.*

```json
{
  "metadata": {
    "name": "James Hoffmann V2",
    "author": "James Hoffmann",
    "description": "Better 1-Cup V60 technique for 15g doses.",
    "visualizer_hint": "pulse_block"
  },
  "equipment": {
    "dripper": { "model": "V60", "material": "Plastic" }
  },
  "ingredients": {
    "coffee_g": 15.0,
    "water_g": 250.0,
    "grind_setting": "Medium-Fine"
  },
  "protocol": [
    { "step": 1, "action": "bloom", "water_g": 50, "duration_s": 45, "notes": "2x-3x coffee weight, swirl gently" },
    { "step": 2, "action": "pour", "water_g": 100, "duration_s": 30, "notes": "Pour to 150g total" },
    { "step": 3, "action": "wait", "duration_s": 10 },
    { "step": 4, "action": "pour", "water_g": 100, "duration_s": 30, "notes": "Pour to 250g total" },
    { "step": 5, "action": "swirl", "duration_s": 5, "notes": "Gentle swirl to flatten bed" },
    { "step": 6, "action": "wait", "duration_s": 90, "notes": "Allow to drain completely" }
  ]
}
```

### 3. Lance Hedrick Single Pour

*Long bloom to maximize extraction without agitation.*

```json
{
  "metadata": {
    "name": "Lance Hedrick Single Pour",
    "author": "Lance Hedrick",
    "description": "The Ultimate 1-Pour method. High extraction, low fines migration.",
    "visualizer_hint": "linear_ramp"
  },
  "equipment": {
    "dripper": { "model": "V60", "material": "Plastic" }
  },
  "ingredients": {
    "coffee_g": 20.0,
    "water_g": 340.0,
    "grind_setting": "Medium-Coarse"
  },
  "protocol": [
    { "step": 1, "action": "bloom", "water_g": 60, "duration_s": 60, "notes": "3x coffee weight bloom" },
    { "step": 2, "action": "pour", "water_g": 280, "duration_s": 120, "flow_rate": "steady", "notes": "Single continuous pour, center only" }
  ]
}
```

### 4. Tetsu Kasuya "God/Devil" (Hario Switch)

*Hybrid technique utilizing thermal decline.*

```json
{
  "metadata": {
    "name": "Tetsu Kasuya God/Devil",
    "author": "Tetsu Kasuya",
    "description": "Hot percolation followed by cool immersion.",
    "visualizer_hint": "pulse_block"
  },
  "equipment": {
    "dripper": { "model": "Switch", "material": "Glass" }
  },
  "ingredients": {
    "coffee_g": 20.0,
    "water_g": 280.0,
    "grind_setting": "Medium-Fine"
  },
  "protocol": [
    { "step": 1, "action": "pour", "water_g": 100, "duration_s": 15, "valve_state": "open", "notes": "Hot percolation phase" },
    { "step": 2, "action": "wait", "duration_s": 30, "valve_state": "closed", "notes": "Close valve" },
    { "step": 3, "action": "pour", "water_g": 180, "duration_s": 20, "valve_state": "closed", "notes": "Immersion phase" },
    { "step": 4, "action": "wait", "duration_s": 120, "valve_state": "closed", "notes": "Steep and cool" },
    { "step": 5, "action": "wait", "duration_s": 60, "valve_state": "open", "notes": "Open valve, drain" }
  ]
}
```

---

## Integration with MeticAI

### Pour-Over Mode Enhancement

The OPOS schema could enhance MeticAI's Pour-Over mode by:

1. **Recipe Library** — Import/export OPOS recipes from Beanconqueror, Visualizer, or community sources
2. **Guided Brewing** — Display step-by-step prompts with timers and weight targets
3. **Visual Feedback** — Render `pulse_block` or `linear_ramp` curves matching the recipe style
4. **Auto-detection** — Recognize pour patterns and suggest matching OPOS recipes

### Machine Integration

For Meticulous Espresso Machine compatibility:

1. **Profile Conversion** — Transform OPOS recipes to OEPF profile format (temperature=0, power=0 for pour-over)
2. **Stage Mapping** — Each OPOS protocol step becomes an OEPF stage with appropriate exit conditions
3. **Weight Targets** — Use cumulative `water_g` values as stage exit weights

---

## References

1. [Beanconqueror Changelog](https://beanconqueror.com/changelog/)
2. [Coffee Visualizer (GitHub)](https://github.com/miharekar/visualizer)
3. [Tetsu Kasuya V60 Ambassador Q&A](https://www.hario-europe.com/blogs/hario-community/v60-ambassadors-tetsu-kasuya)
4. [The Coffee Chronicler's V60 Guide](https://coffeechronicler.com/hario-v60-recipe-guide/)
5. [r/pourover Recipe Collection](https://www.reddit.com/r/pourover/comments/19btejo/hario_v60_recipes/)
