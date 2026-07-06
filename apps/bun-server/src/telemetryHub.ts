/**
 * Live telemetry hub.
 *
 * Maintains a single upstream Socket.IO connection to the machine and fans the
 * derived telemetry snapshot out to every connected browser WebSocket client at
 * `/api/ws/live`. This replaces the 2.x MQTT bridge + Python websocket route:
 * the wire shape sent to the browser is byte-for-byte the flat snapshot the
 * frontend already consumes (see useMachineTelemetry), including `_ts` stamps
 * and periodic `{_heartbeat:true}` frames, so the client needs no changes.
 *
 * The Socket.IO -> snapshot mapping mirrors the direct-mode mapping in
 * useMachineTelemetry.ts, keeping proxy mode and native mode at parity.
 */

import { io, type Socket } from "socket.io-client";
import type { Logger } from "@metic/core/platform";

export interface TelemetrySnapshot {
  connected: boolean;
  availability: "online" | "offline" | null;
  boiler_temperature: number | null;
  brew_head_temperature: number | null;
  target_temperature: number | null;
  brewing: boolean;
  state: string | null;
  pressure: number | null;
  flow_rate: number | null;
  power: number | null;
  shot_weight: number | null;
  shot_timer: number | null;
  target_weight: number | null;
  preheat_countdown: number | null;
  active_profile: string | null;
  total_shots: number | null;
  brightness: number | null;
  sounds_enabled: boolean | null;
  voltage: number | null;
  firmware_version: string | null;
  last_shot_time: number | null;
  last_shot_name: string | null;
}

// Espresso machines operate 0-150°C; values outside are transient glitches.
const TEMP_MIN = 0;
const TEMP_MAX = 150;
function clampTemp(val: unknown, fallback: number | null): number | null {
  if (typeof val !== "number" || Number.isNaN(val)) return fallback;
  if (val < TEMP_MIN || val > TEMP_MAX) return fallback;
  return val;
}

function num(val: unknown, fallback: number | null): number | null {
  return typeof val === "number" && !Number.isNaN(val) ? val : fallback;
}

const HEARTBEAT_MS = 5_000;
const FRAME_INTERVAL_MS = 100; // cap fan-out at ~10 FPS to protect low-power hosts

/** Minimal shape of the machine's Socket.IO `status` payload we consume. */
interface StatusData {
  sensors?: { t?: number; p?: number; f?: number; w?: number };
  setpoints?: { temperature?: number };
  profile_time?: number;
  name?: string;
  state?: string;
  profile?: string;
  loaded_profile?: string;
  extracting?: boolean;
  // Seeded / optimistic fields.
  total_shots?: number;
  firmware_version?: string;
  sounds_enabled?: boolean;
  voltage?: number;
  preheat_countdown?: number;
}

function emptySnapshot(): TelemetrySnapshot {
  return {
    connected: false,
    availability: null,
    boiler_temperature: null,
    brew_head_temperature: null,
    target_temperature: null,
    brewing: false,
    state: null,
    pressure: null,
    flow_rate: null,
    power: null,
    shot_weight: null,
    shot_timer: null,
    target_weight: null,
    preheat_countdown: null,
    active_profile: null,
    total_shots: null,
    brightness: null,
    sounds_enabled: null,
    voltage: null,
    firmware_version: null,
    last_shot_time: null,
    last_shot_name: null,
  };
}

/** A single browser client the hub can push frames to. */
export interface TelemetryClient {
  send(data: string): void;
}

export class TelemetryHub {
  private snapshot = emptySnapshot();
  private clients = new Set<TelemetryClient>();
  private socket: Socket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  private pendingFlush: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
    private readonly seed: (baseUrl: string) => Promise<Partial<TelemetrySnapshot>> = defaultSeed,
  ) {}

  /** Number of currently connected browser clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Current snapshot (used for the immediate frame sent on subscribe). */
  getSnapshot(): TelemetrySnapshot {
    return this.snapshot;
  }

  /** Register a browser client and send it the current snapshot immediately. */
  addClient(client: TelemetryClient): void {
    this.clients.add(client);
    this.ensureUpstream();
    client.send(this.frame(this.snapshot));
  }

  removeClient(client: TelemetryClient): void {
    this.clients.delete(client);
    if (this.clients.size === 0) this.teardownUpstream();
  }

  private frame(snapshot: TelemetrySnapshot): string {
    return JSON.stringify({ ...snapshot, _ts: Date.now() / 1000 });
  }

  private broadcast(): void {
    // Rate-limit to FRAME_INTERVAL_MS; coalesce bursts into a trailing flush.
    const now = Date.now();
    const elapsed = now - this.lastFrameAt;
    if (elapsed >= FRAME_INTERVAL_MS) {
      this.flush();
    } else if (!this.pendingFlush) {
      this.pendingFlush = setTimeout(() => this.flush(), FRAME_INTERVAL_MS - elapsed);
    }
  }

  private flush(): void {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = null;
    }
    this.lastFrameAt = Date.now();
    const data = this.frame(this.snapshot);
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private ensureUpstream(): void {
    if (this.socket || !this.baseUrl) return;

    this.logger.info("telemetry hub connecting upstream", { baseUrl: this.baseUrl });
    const socket = io(this.baseUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.snapshot = { ...this.snapshot, connected: true, availability: "online" };
      this.broadcast();
      void this.applySeed();
    });
    socket.on("disconnect", () => {
      this.snapshot = { ...this.snapshot, connected: false, availability: "offline" };
      this.broadcast();
    });
    socket.on("connect_error", (err: Error) => {
      this.logger.debug("telemetry upstream connect_error", err.message);
    });

    socket.on("status", (data: StatusData) => this.applyStatus(data));
    socket.on("sensors", (data: { t_bar_up?: number; t_bar_down?: number }) => {
      this.snapshot = {
        ...this.snapshot,
        boiler_temperature: clampTemp(data.t_bar_up, this.snapshot.boiler_temperature),
        brew_head_temperature: clampTemp(data.t_bar_down, this.snapshot.brew_head_temperature),
      };
      this.broadcast();
    });
    socket.on("actuators", (data: { bh_pwr?: number }) => {
      this.snapshot = { ...this.snapshot, power: num(data.bh_pwr, this.snapshot.power) };
      this.broadcast();
    });
    socket.on("heater_status", (countdown: number) => {
      this.snapshot = {
        ...this.snapshot,
        preheat_countdown: num(countdown, this.snapshot.preheat_countdown),
      };
      this.broadcast();
    });

    this.heartbeat = setInterval(() => {
      if (this.clients.size === 0) return;
      const beat = JSON.stringify({ _heartbeat: true, _ts: Date.now() / 1000 });
      for (const client of this.clients) {
        try {
          client.send(beat);
        } catch {
          this.clients.delete(client);
        }
      }
    }, HEARTBEAT_MS);
  }

  private applyStatus(data: StatusData): void {
    const prev = this.snapshot;
    const shotTimer = data.profile_time != null ? data.profile_time / 1000 : prev.shot_timer;
    const profileName = data.loaded_profile || data.profile || prev.active_profile;

    // Preserve a "preheating" state while the preheat countdown is active.
    const rawState = data.name || data.state || "";
    const isIdleish = rawState === "idle" || rawState === "Idle" || rawState === "";
    const state =
      prev.preheat_countdown != null && prev.preheat_countdown > 0 && isIdleish
        ? "preheating"
        : data.name || data.state || prev.state;

    this.snapshot = {
      ...prev,
      connected: true,
      availability: "online",
      boiler_temperature: clampTemp(data.sensors?.t, prev.boiler_temperature),
      pressure: num(data.sensors?.p, prev.pressure),
      flow_rate: num(data.sensors?.f, prev.flow_rate),
      shot_weight: num(data.sensors?.w, prev.shot_weight),
      shot_timer: shotTimer,
      state,
      brewing: data.extracting ?? prev.brewing,
      active_profile: profileName,
      target_temperature: clampTemp(data.setpoints?.temperature, prev.target_temperature),
      total_shots: num(data.total_shots, prev.total_shots),
      firmware_version: data.firmware_version ?? prev.firmware_version,
      sounds_enabled: data.sounds_enabled ?? prev.sounds_enabled,
      voltage: num(data.voltage, prev.voltage),
      preheat_countdown:
        data.preheat_countdown != null ? data.preheat_countdown : prev.preheat_countdown,
    };
    this.broadcast();
  }

  private async applySeed(): Promise<void> {
    try {
      const seeded = await this.seed(this.baseUrl);
      if (Object.keys(seeded).length > 0) {
        this.snapshot = { ...this.snapshot, ...seeded };
        this.broadcast();
      }
    } catch (err) {
      this.logger.debug("telemetry seed failed", err instanceof Error ? err.message : String(err));
    }
  }

  private teardownUpstream(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.snapshot = emptySnapshot();
  }

  /** Release all resources (test teardown / server shutdown). */
  close(): void {
    this.clients.clear();
    this.teardownUpstream();
  }
}

/**
 * Seed the fields the machine's Socket.IO status stream never emits
 * (firmware, mains voltage, whether UI sounds are enabled) from its REST API.
 * Best-effort: failures leave the fields at their previous values.
 */
async function defaultSeed(baseUrl: string): Promise<Partial<TelemetrySnapshot>> {
  const out: Partial<TelemetrySnapshot> = {};
  const [machineRes, settingsRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/v1/machine`),
    fetch(`${baseUrl}/api/v1/settings`),
  ]);
  if (machineRes.status === "fulfilled" && machineRes.value.ok) {
    const m = (await machineRes.value.json()) as { firmware?: string; mainVoltage?: number };
    if (typeof m.firmware === "string") out.firmware_version = m.firmware;
    if (typeof m.mainVoltage === "number") out.voltage = m.mainVoltage;
  }
  if (settingsRes.status === "fulfilled" && settingsRes.value.ok) {
    const s = (await settingsRes.value.json()) as { enable_sounds?: boolean };
    if (typeof s.enable_sounds === "boolean") out.sounds_enabled = s.enable_sounds;
  }
  return out;
}
