/**
 * Pour-over profile adapters.
 *
 * Pure logic (no DOM, no host dependencies) that builds a Meticulous OEPF
 * profile from either ratio-based pour-over options or an OPOS-style recipe.
 * Ported byte-for-byte from the native oracle
 * (apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *  _adaptPourOverProfile / _adaptRecipeToProfile) so both runtimes build the
 * exact same machine profile, and mirrors the server adapters
 * (apps/server pour_over_adapter.py / recipe_adapter.py).
 *
 * The resulting profile is loaded onto the machine by the pour-over routes.
 */

import { safeRandomUUID } from "./uuid";

export interface PourOverOptions {
  targetWeight: number;
  bloomEnabled: boolean;
  bloomSeconds: number;
  doseGrams: number | null;
  brewRatio: number | null;
}

export interface OposStep {
  step?: number;
  action?: string;
  water_g?: number;
  duration_s?: number;
  notes?: string;
}

export interface RecipeInput {
  metadata?: { name?: string };
  ingredients?: { water_g?: number; coffee_g?: number } & Record<string, unknown>;
  protocol?: OposStep[];
}

/** A loosely-typed OEPF profile object (matches what the machine save accepts). */
export type AdaptedProfile = Record<string, unknown>;

const POUR_OVER_BASE = {
  name: "MeticAI Ratio Pour-Over",
  id: "",
  author: "MeticAI",
  author_id: "",
  display: { accentColor: "#566656" } as Record<string, unknown>,
  temperature: 0,
  final_weight: 300,
  variables: [{ name: "Zero", key: "power_Zero", type: "power", value: 0 }],
  stages: [
    {
      name: "Bloom (30s)",
      key: "power_1",
      type: "power",
      dynamics: { points: [[0, "$power_Zero"], [10, "$power_Zero"]], over: "time", interpolation: "curve" },
      exit_triggers: [{ type: "time", value: 30, relative: false, comparison: ">=" }],
      limits: [],
    },
    {
      name: "Infusion (300g)",
      key: "power_2",
      type: "power",
      dynamics: { points: [[0, "$power_Zero"], [10, "$power_Zero"]], over: "time", interpolation: "curve" },
      exit_triggers: [{ type: "weight", value: 300, relative: false, comparison: ">=" }],
      limits: [],
    },
  ],
};

const STAGE_TEMPLATE = {
  type: "power",
  dynamics: { points: [[0, "$power_Zero"], [10, "$power_Zero"]], over: "time", interpolation: "curve" },
  limits: [],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface Trigger {
  type: string;
  value: number;
  relative: boolean;
  comparison: string;
}

interface Stage {
  name: string;
  key: string;
  type: string;
  dynamics: unknown;
  exit_triggers: Trigger[];
  limits: unknown[];
}

/** Build a ratio/bloom pour-over profile. */
export function adaptPourOverProfile(opts: PourOverOptions): AdaptedProfile {
  const profile = clone(POUR_OVER_BASE) as typeof POUR_OVER_BASE & AdaptedProfile;
  profile.id = safeRandomUUID();
  profile.author_id = safeRandomUUID();
  profile.final_weight = opts.targetWeight;
  const weightLabel = `${Math.round(opts.targetWeight)}g`;

  const parts = [`Target: ${weightLabel}`];
  if (opts.doseGrams) parts.push(`Dose: ${opts.doseGrams.toFixed(1)}g`);
  if (opts.brewRatio) parts.push(`Ratio: 1:${opts.brewRatio.toFixed(1)}`);
  profile.display = { ...profile.display, shortDescription: parts.join(" | ").slice(0, 99) };

  const stages = profile.stages as unknown as Stage[];
  if (opts.bloomEnabled && stages.length >= 2) {
    stages[0]!.name = `Bloom (${Math.round(opts.bloomSeconds)}s)`;
    for (const t of stages[0]!.exit_triggers) if (t.type === "time") t.value = opts.bloomSeconds;
    stages[1]!.name = `Infusion (${weightLabel})`;
    for (const t of stages[1]!.exit_triggers) if (t.type === "weight") t.value = opts.targetWeight;
    if (!stages[1]!.exit_triggers.some((t) => t.type === "time")) {
      stages[1]!.exit_triggers.push({ type: "time", value: 600, relative: true, comparison: ">=" });
    }
  } else if (!opts.bloomEnabled && stages.length >= 2) {
    const infusion = stages[1]!;
    infusion.name = `Infusion (${weightLabel})`;
    infusion.key = "power_1";
    for (const t of infusion.exit_triggers) if (t.type === "weight") t.value = opts.targetWeight;
    if (!infusion.exit_triggers.some((t) => t.type === "time")) {
      infusion.exit_triggers.push({ type: "time", value: 600, relative: true, comparison: ">=" });
    }
    (profile as AdaptedProfile).stages = [infusion];
  }
  return profile;
}

/** Build a profile from an OPOS-style recipe. */
export function adaptRecipeToProfile(recipe: RecipeInput): AdaptedProfile {
  const profile = clone(POUR_OVER_BASE) as typeof POUR_OVER_BASE & AdaptedProfile;
  profile.id = safeRandomUUID();
  profile.author_id = safeRandomUUID();
  const recipeName = recipe.metadata?.name ?? "Recipe";
  profile.name = `MeticAI Recipe: ${recipeName}`;
  const totalWater = Number(recipe.ingredients?.water_g ?? 0);
  const coffeeG = Number(recipe.ingredients?.coffee_g ?? 0) || null;
  profile.final_weight = totalWater;

  const parts = [`Target: ${Math.round(totalWater)}g`];
  if (coffeeG) {
    parts.push(`Dose: ${Math.round(coffeeG)}g`);
    parts.push(`Ratio: 1:${(totalWater / coffeeG).toFixed(1)}`);
  }
  profile.display = { ...profile.display, shortDescription: parts.join(" | ").slice(0, 99) };

  const stages: Stage[] = [];
  let cumulativeWater = 0;
  let pourCount = 0;

  for (const step of recipe.protocol ?? []) {
    const action = step.action ?? "";
    const waterG = Number(step.water_g ?? 0);
    const durationS = Number(step.duration_s ?? 30);
    const stage = clone(STAGE_TEMPLATE) as unknown as Stage;
    stage.key = `power_${stages.length + 1}`;

    if (action === "bloom" || action === "pour") {
      cumulativeWater += waterG;
      if (action === "bloom") {
        stage.name = `Bloom (${Math.round(waterG)}g / ${Math.round(durationS)}s)`;
        stage.exit_triggers = [{ type: "time", value: durationS, relative: true, comparison: ">=" }];
      } else {
        pourCount++;
        stage.name = `Pour ${pourCount} (to ${Math.round(cumulativeWater)}g)`;
        stage.exit_triggers = [
          { type: "weight", value: cumulativeWater, relative: false, comparison: ">=" },
          { type: "time", value: 600, relative: true, comparison: ">=" },
        ];
      }
    } else if (action === "wait" || action === "swirl" || action === "stir") {
      stage.name = action === "swirl" ? "Swirl" : action === "stir" ? "Stir" : `Wait (${Math.round(durationS)}s)`;
      stage.exit_triggers = [{ type: "time", value: durationS, relative: true, comparison: ">=" }];
    } else {
      continue;
    }

    stages.push(stage);
  }

  (profile as AdaptedProfile).stages = stages;
  return profile;
}
