/**
 * Estimated target-curve generation (pure, host-free).
 *
 * Builds the target pressure/flow/power curve the machine intends to follow for
 * a profile, used by the live graph and the pre-shot breakdown. Ported verbatim
 * from apps/web/src/services/interceptor/DirectModeInterceptor.ts so both
 * runtimes produce identical curves.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A profile shape with the stage/variable fields the curve generator reads. */
export interface CurveProfile {
  stages?: unknown[];
  variables?: unknown[];
}

function resolveProfileValue(value: unknown, variables: Array<Record<string, unknown>>): number {
  if (typeof value === "string" && value.startsWith("$")) {
    const key = value.slice(1);
    const variable = variables.find((item) => item.key === key || item.name === key);
    return safeNumber(variable?.value);
  }
  return safeNumber(value);
}

function buildTimeBasedCurvePoints(
  points: unknown[],
  variables: Array<Record<string, unknown>>,
  stageName: string,
  key: string,
  stageStart: number,
  stageEnd: number,
): Array<Record<string, unknown>> {
  const stageDuration = stageEnd - stageStart;
  const result: Array<Record<string, unknown>> = [];
  let prevT: number | null = null;
  let prevV: number | null = null;
  let lastT: number | null = null;
  let lastV: number | null = null;

  for (const point of points) {
    if (!Array.isArray(point)) continue;
    const dpT = safeNumber(point[0]);
    const dpV = resolveProfileValue(point[1] ?? point[0], variables);

    if (dpT > stageDuration) {
      let boundaryV = dpV;
      if (prevT !== null && prevV !== null && dpT > prevT) {
        const frac = (stageDuration - prevT) / (dpT - prevT);
        boundaryV = prevV + (dpV - prevV) * frac;
      }
      result.push({
        time: Number(stageEnd.toFixed(2)),
        stage_name: stageName,
        [key]: Math.round(boundaryV * 10) / 10,
      });
      return result;
    }

    result.push({
      time: Number((stageStart + dpT).toFixed(2)),
      stage_name: stageName,
      [key]: Math.round(dpV * 10) / 10,
    });
    prevT = dpT;
    prevV = dpV;
    lastT = dpT;
    lastV = dpV;
  }

  if (lastT !== null && lastV !== null && lastT < stageDuration - 1e-6) {
    result.push({
      time: Number(stageEnd.toFixed(2)),
      stage_name: stageName,
      [key]: Math.round(lastV * 10) / 10,
    });
  }

  return result;
}

export function generateEstimatedTargetCurves(
  profile: CurveProfile,
): Array<Record<string, unknown>> {
  const stages = (profile.stages ?? []) as Array<Record<string, unknown>>;
  const variables = (profile.variables ?? []) as Array<Record<string, unknown>>;
  const defaultStageDuration = 10;
  const weightStageMaxEstimate = 15;
  const durations = stages.map((stage) => {
    const triggers = Array.isArray(stage.exit_triggers) ? stage.exit_triggers : [];
    let timeTrigger: number | null = null;
    let hasWeightTrigger = false;
    for (const trigger of triggers) {
      if (!isRecord(trigger)) continue;
      if (trigger.type === "time")
        timeTrigger = resolveProfileValue(trigger.value, variables) || defaultStageDuration;
      if (trigger.type === "weight") hasWeightTrigger = true;
    }
    if (timeTrigger === null) return defaultStageDuration;
    return hasWeightTrigger ? Math.min(timeTrigger, weightStageMaxEstimate) : timeTrigger;
  });

  const curves: Array<Record<string, unknown>> = [];
  let runningTime = 0;
  stages.forEach((stage, index) => {
    const stageName = typeof stage.name === "string" ? stage.name : `Stage ${index + 1}`;
    const stageType = typeof stage.type === "string" ? stage.type : "flow";
    const duration = durations[index] ?? defaultStageDuration;
    const dynamics = isRecord(stage.dynamics) ? stage.dynamics : {};
    const points = Array.isArray(stage.dynamics_points)
      ? stage.dynamics_points
      : Array.isArray(dynamics.points)
        ? dynamics.points
        : [];
    if (points.length === 0) {
      runningTime += duration;
      return;
    }
    const key =
      stageType === "pressure"
        ? "target_pressure"
        : stageType === "power"
          ? "target_power"
          : "target_flow";
    const stageStart = runningTime;
    const stageEnd = runningTime + duration;
    if (points.length === 1 && Array.isArray(points[0])) {
      const value = resolveProfileValue(points[0][1] ?? points[0][0], variables);
      curves.push(
        { time: Number(stageStart.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
        { time: Number(stageEnd.toFixed(2)), stage_name: stageName, [key]: Math.round(value * 10) / 10 },
      );
    } else {
      curves.push(
        ...buildTimeBasedCurvePoints(points, variables, stageName, key, stageStart, stageEnd),
      );
    }
    runningTime = stageEnd;
  });
  return curves.sort((a, b) => safeNumber(a.time) - safeNumber(b.time));
}
