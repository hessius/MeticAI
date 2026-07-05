/**
 * Re-export of the Espresso-Compass rules, now canonically owned by
 * `@metic/core`. Kept as a thin shim so existing frontend imports keep working
 * while the 3.0.0 core extraction proceeds.
 */
export {
  COMPASS_DEADBAND,
  compassAdjustments,
} from "@metic/core/logic/compass";
export type {
  CompassAdjustmentKind,
  CompassAdjustment,
} from "@metic/core/logic/compass";
