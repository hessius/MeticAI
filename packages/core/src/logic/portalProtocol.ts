/**
 * Belka Portal Bluetooth LE protocol — constants and packet parsing.
 *
 * Host-free: the Web Bluetooth transport lives in the web app
 * (`apps/web/src/services/portal/portalBle.ts`); this module only knows what
 * the bytes mean, so it can be unit-tested without a browser.
 *
 * Source of the protocol: the `variegated-belka-portal-trouble-driver` crate in
 * variegated-coffee/variegated-rs (MIT), cross-checked against Decenza's
 * `belkaportalprotocol.h`. Verified on hardware by those projects; this port is
 * verified against a simulated Portal that speaks the same bytes.
 */

/** Primary service, advertised by the Portal — filter on it in the chooser. */
export const PORTAL_SERVICE_UUID = 0x7400;
/** Measurement characteristic: read + notify, 13-byte packets. */
export const PORTAL_MEASUREMENT_UUID = 0x7410;
/** Command characteristic: write-with-response, 4-byte commands. */
export const PORTAL_COMMAND_UUID = 0x7420;

export const PORTAL_PACKET_LENGTH = 13;

/** Show the live graph on the Portal's own screen. */
export const PORTAL_CMD_SHOW_GRAPH: readonly number[] = Object.freeze([0x40, 0x00, 0x01, 0x2d]);
/** Return the Portal's screen to its idle view. */
export const PORTAL_CMD_HIDE_GRAPH: readonly number[] = Object.freeze([0x40, 0x00, 0x01, 0x2e]);

/** Device-name fallbacks for a chooser that does not list by service. */
export const PORTAL_NAME_PREFIXES: readonly string[] = Object.freeze(["PORTAL", "Portal", "Belka"]);

export interface PortalMeasurement {
  /** Conductivity, in the Portal's units (mS/cm presumed). */
  ec: number;
  /** Portal's internal temperature, °C. */
  tInt: number;
  /** Outlet (liquid) temperature, °C. */
  tOut: number;
  /** Status byte; battery-like, semantics unverified. */
  status: number;
}

/**
 * Parse one 13-byte measurement notification:
 *   EC f32 LE @0 · internal temp f32 LE @4 · outlet temp f32 LE @8 · status u8 @12
 * Returns null for any other length so a caller can count malformed packets.
 */
export function parsePortalMeasurement(view: DataView): PortalMeasurement | null {
  if (view.byteLength !== PORTAL_PACKET_LENGTH) return null;
  return {
    ec: view.getFloat32(0, true),
    tInt: view.getFloat32(4, true),
    tOut: view.getFloat32(8, true),
    status: view.getUint8(12),
  };
}

/** Build a 13-byte packet — for simulators and tests. */
export function encodePortalMeasurement(m: PortalMeasurement): Uint8Array {
  const buf = new Uint8Array(PORTAL_PACKET_LENGTH);
  const view = new DataView(buf.buffer);
  view.setFloat32(0, m.ec, true);
  view.setFloat32(4, m.tInt, true);
  view.setFloat32(8, m.tOut, true);
  view.setUint8(12, m.status & 0xff);
  return buf;
}
