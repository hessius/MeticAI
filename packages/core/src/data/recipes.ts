/**
 * Bundled pour-over recipe library (single source of truth).
 *
 * Canonical data for GET /api/recipes, shared by the Node/Bun server and the
 * browser/Capacitor runtime. Sorted alphabetically by name. The Python backend
 * keeps its own copy under data/recipes/ only until it is removed in Phase 7.
 */

export interface PourOverRecipe {
  version: string;
  metadata: {
    name: string;
    author: string;
    description: string;
    compatibility: string[];
    visualizer_hint?: string;
  };
  equipment: Record<string, unknown>;
  ingredients: Record<string, unknown>;
  protocol: Array<Record<string, unknown>>;
  slug: string;
}

export const POUR_OVER_RECIPES: PourOverRecipe[] = [
  {
    "version": "1.1.0",
    "metadata": {
      "name": "4:6 Method (Lighter)",
      "author": "Tetsu Kasuya",
      "description": "Lighter-bodied 4:6 with a single strength pour. First 40% (two pours of 60g) controls sweetness; final 60% (one pour of 180g) produces a lighter, cleaner cup. Use a coarse grind for clarity.",
      "compatibility": [
        "V60",
        "April",
        "Origami"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Ceramic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 300.0,
      "grind_setting": "Coarse"
    },
    "protocol": [
      {
        "step": 1,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "First pour — controls sweetness"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Second pour — controls sweetness"
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 180,
        "duration_s": 45,
        "notes": "Single combined strength pour to 300g total"
      }
    ],
    "slug": "4-6-method-lighter"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "4:6 Method (Standard)",
      "author": "Tetsu Kasuya",
      "description": "Classic 4:6 with two equal strength pours. First 40% (two pours of 60g) controls sweetness; final 60% (two pours of 90g) controls strength. Use a coarse grind for clarity.",
      "compatibility": [
        "V60",
        "April",
        "Origami"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Ceramic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 300.0,
      "grind_setting": "Coarse"
    },
    "protocol": [
      {
        "step": 1,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "First pour — controls sweetness"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Second pour — controls sweetness"
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 90,
        "duration_s": 20,
        "notes": "Third pour — controls strength"
      },
      {
        "step": 6,
        "action": "wait",
        "duration_s": 60,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 7,
        "action": "pour",
        "water_g": 90,
        "duration_s": 20,
        "notes": "Fourth pour — controls strength"
      }
    ],
    "slug": "4-6-method-standard"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "4:6 Method (Stronger)",
      "author": "Tetsu Kasuya",
      "description": "Adjust sweetness with the first 40% of water (pours 1–2) and strength with the final 60% (pours 3–5). Use a coarse grind for clarity.",
      "compatibility": [
        "V60",
        "April",
        "Origami"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Ceramic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 300.0,
      "grind_setting": "Coarse"
    },
    "protocol": [
      {
        "step": 1,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "First pour — controls sweetness"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Second pour — controls sweetness"
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Third pour — controls strength"
      },
      {
        "step": 6,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 7,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Fourth pour — controls strength"
      },
      {
        "step": 8,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait for the bed to drain"
      },
      {
        "step": 9,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Fifth pour — controls strength"
      }
    ],
    "slug": "4-6-method"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "Better 1-Cup V60",
      "author": "James Hoffmann",
      "description": "Better 1-Cup V60 technique. 50g bloom with a mid-bloom swirl, then four measured pours of 50g each with 10-second pauses, finished with a gentle swirl.",
      "compatibility": [
        "V60"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Plastic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 15.0,
      "water_g": 250.0,
      "grind_setting": "Medium-Fine"
    },
    "protocol": [
      {
        "step": 1,
        "action": "bloom",
        "water_g": 50,
        "duration_s": 10,
        "notes": "Pour 50g to bloom"
      },
      {
        "step": 2,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Gently swirl at 10–15s"
      },
      {
        "step": 3,
        "action": "wait",
        "duration_s": 30,
        "notes": "Finish bloom — wait until 0:45"
      },
      {
        "step": 4,
        "action": "pour",
        "water_g": 50,
        "duration_s": 15,
        "notes": "Pour to 100g total (40% weight)"
      },
      {
        "step": 5,
        "action": "wait",
        "duration_s": 10
      },
      {
        "step": 6,
        "action": "pour",
        "water_g": 50,
        "duration_s": 10,
        "notes": "Pour to 150g total (60% weight)"
      },
      {
        "step": 7,
        "action": "wait",
        "duration_s": 10
      },
      {
        "step": 8,
        "action": "pour",
        "water_g": 50,
        "duration_s": 10,
        "notes": "Pour to 200g total (80% weight)"
      },
      {
        "step": 9,
        "action": "wait",
        "duration_s": 10
      },
      {
        "step": 10,
        "action": "pour",
        "water_g": 50,
        "duration_s": 10,
        "notes": "Pour to 250g total (100% weight)"
      },
      {
        "step": 11,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Gently swirl to flatten the bed"
      },
      {
        "step": 12,
        "action": "wait",
        "duration_s": 60,
        "notes": "Allow to drain completely"
      }
    ],
    "slug": "hoffmann-v2"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "Go-To V60",
      "author": "Pierre Tymms / Nordic Brew Lab",
      "description": "Reliable everyday V60 with three progressive pours building to a final large pour. Balanced extraction with a medium-coarse grind targeting 2:45–3:00 total brew time.",
      "compatibility": [
        "V60",
        "Origami",
        "April"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Ceramic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 18.0,
      "water_g": 300.0,
      "grind_setting": "Medium-Coarse"
    },
    "protocol": [
      {
        "step": 1,
        "action": "bloom",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Pour 60g to bloom — gentle spiral to saturate all grounds"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 15,
        "notes": "Wait until 0:30 — let bloom degas"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Pour to 120g — steady centre pour"
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 15,
        "notes": "Wait until 1:00"
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "notes": "Pour to 180g — steady centre pour"
      },
      {
        "step": 6,
        "action": "wait",
        "duration_s": 15,
        "notes": "Wait until 1:30"
      },
      {
        "step": 7,
        "action": "pour",
        "water_g": 120,
        "duration_s": 20,
        "notes": "Pour to 300g — larger final pour, centre circles"
      },
      {
        "step": 8,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Gentle swirl to level the bed"
      }
    ],
    "slug": "nordic-brew-lab-goto"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "God/Devil Switch",
      "author": "Tetsu Kasuya",
      "description": "Hario Switch recipe. Open-valve hot percolation for the first 120g, then close the valve for cool immersion to 280g. Requires a gooseneck kettle with adjustable temperature.",
      "compatibility": [
        "Hario Switch"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "Switch",
        "material": "Glass"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 280.0,
      "grind_setting": "Medium-Fine"
    },
    "protocol": [
      {
        "step": 1,
        "action": "pour",
        "water_g": 60,
        "duration_s": 15,
        "valve_state": "open",
        "notes": "Valve OPEN — pour 60g at 90°C"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 15,
        "valve_state": "open",
        "notes": "Wait — valve remains open, percolating"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 60,
        "duration_s": 20,
        "valve_state": "open",
        "notes": "Pour 60g more to 120g total — still at 90°C. Begin lowering kettle temperature to 70°C now."
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 25,
        "valve_state": "open",
        "notes": "Wait until ~1:15. Ensure water is at 70°C before next step."
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 160,
        "duration_s": 25,
        "valve_state": "closed",
        "notes": "CLOSE valve, then pour 160g at 70°C to 280g total — immersion phase begins"
      },
      {
        "step": 6,
        "action": "wait",
        "duration_s": 30,
        "valve_state": "closed",
        "notes": "Steep with valve closed"
      },
      {
        "step": 7,
        "action": "wait",
        "duration_s": 60,
        "valve_state": "open",
        "notes": "OPEN valve — drain. Aim to complete by 3-minute mark."
      }
    ],
    "slug": "kasuya-god-devil"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "One and Done Double Bloom",
      "author": "Lance Hedrick",
      "description": "Double bloom technique for maximum extraction clarity. Two short blooms fully saturate the bed before a single aggressive centre pour. Grind finer than typical (target 2:00–2:30 draw down). Use 93–96°C for light roasts, 90–93°C for medium, lower for darker roasts. 1:15 ratio.",
      "compatibility": [
        "V60",
        "Origami",
        "April"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Plastic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 15.0,
      "water_g": 225.0,
      "grind_setting": "Fine"
    },
    "protocol": [
      {
        "step": 1,
        "action": "bloom",
        "water_g": 45,
        "duration_s": 10,
        "flow_rate": "steady",
        "notes": "Pour 45g (3× dose) at 5–10 ml/s — first bloom to wet all grounds"
      },
      {
        "step": 2,
        "action": "wait",
        "duration_s": 20,
        "notes": "Wait until 0:30 — let first bloom degas"
      },
      {
        "step": 3,
        "action": "pour",
        "water_g": 45,
        "duration_s": 10,
        "flow_rate": "steady",
        "notes": "Pour to 90g at 5–10 ml/s — second bloom for full saturation"
      },
      {
        "step": 4,
        "action": "wait",
        "duration_s": 20,
        "notes": "Wait until 1:00 — let second bloom settle"
      },
      {
        "step": 5,
        "action": "pour",
        "water_g": 135,
        "duration_s": 15,
        "flow_rate": "fast",
        "notes": "Pour to 225g at 9–10 ml/s in coin-sized circles in the centre — single aggressive main pour"
      },
      {
        "step": 6,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Gentle Rao spin to level the bed"
      }
    ],
    "slug": "lance-hedrick-double-bloom"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "Single Pour",
      "author": "Lance Hedrick",
      "description": "Long bloom with wet WDT to fully saturate grounds, then one continuous pour. High extraction with minimal fines migration.",
      "compatibility": [
        "V60"
      ],
      "visualizer_hint": "linear_ramp"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Plastic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 340.0,
      "grind_setting": "Medium-Coarse"
    },
    "protocol": [
      {
        "step": 1,
        "action": "bloom",
        "water_g": 60,
        "duration_s": 10,
        "notes": "Pour 60g (3× dose) to saturate all grounds evenly"
      },
      {
        "step": 2,
        "action": "stir",
        "duration_s": 10,
        "notes": "Wet WDT — stir through the grounds with a WDT tool or chopstick to break all dry pockets"
      },
      {
        "step": 3,
        "action": "wait",
        "duration_s": 80,
        "notes": "Wait — total bloom ~1:40"
      },
      {
        "step": 4,
        "action": "pour",
        "water_g": 280,
        "duration_s": 120,
        "flow_rate": "steady",
        "notes": "Single continuous centre pour to 340g — maintain height for turbulence. After draining, swirl if slow / wet WDT if somewhat quick / turn bed with spoon if draining fast."
      }
    ],
    "slug": "lance-hedrick-single-pour"
  },
  {
    "version": "1.1.0",
    "metadata": {
      "name": "V60 Technique",
      "author": "Scott Rao",
      "description": "Centre-pour technique with an aggressive bloom spin (5–7 revolutions), two equal main pours separated by a 50%-drained wait, each followed by a gentle 2-revolution spin. Targets 22–24.5% extraction.",
      "compatibility": [
        "V60"
      ],
      "visualizer_hint": "pulse_block"
    },
    "equipment": {
      "dripper": {
        "model": "V60",
        "material": "Plastic"
      },
      "filter_type": "Paper"
    },
    "ingredients": {
      "coffee_g": 20.0,
      "water_g": 330.0,
      "grind_setting": "Medium"
    },
    "protocol": [
      {
        "step": 1,
        "action": "bloom",
        "water_g": 60,
        "duration_s": 5,
        "notes": "Spiral pour for 60g bloom"
      },
      {
        "step": 2,
        "action": "swirl",
        "duration_s": 10,
        "notes": "Rao Spin — aggressive swirl 5–7 revolutions to fully saturate the bed"
      },
      {
        "step": 3,
        "action": "wait",
        "duration_s": 35,
        "notes": "Wait — total bloom 45s"
      },
      {
        "step": 4,
        "action": "pour",
        "water_g": 135,
        "duration_s": 30,
        "flow_rate": "fast",
        "notes": "Pour to 195g total as fast as possible with a nearly vertical stream"
      },
      {
        "step": 5,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Gentle spin — 2 revolutions to fill ribbed channels"
      },
      {
        "step": 6,
        "action": "wait",
        "duration_s": 45,
        "notes": "Wait until slurry is ~50% drained (visual check)"
      },
      {
        "step": 7,
        "action": "pour",
        "water_g": 135,
        "duration_s": 30,
        "flow_rate": "fast",
        "notes": "Pour to 330g total — same fast, vertical technique"
      },
      {
        "step": 8,
        "action": "swirl",
        "duration_s": 5,
        "notes": "Final gentle spin — 2 revolutions to level the bed and break channels"
      }
    ],
    "slug": "scott-rao-v60"
  }
];
