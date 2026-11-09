/**
 * portalBle — Web Bluetooth transport for the Belka Portal conductivity sensor.
 *
 * Browser-only by nature: Web Bluetooth exists in Chrome and Edge on a secure
 * page (https, or http://localhost). It is absent on iOS/Android WebViews and
 * on plain-http LAN origins, so callers must check `portalEnvironment()` and
 * hide the feature when it cannot work. Protocol constants and packet parsing
 * live in `@metic/core/logic/portalProtocol` so they are shared and testable.
 *
 * One Portal at a time: the sensor accepts a single BLE central, so the Belka
 * phone app must be closed before connecting from here.
 */

import {
  PORTAL_SERVICE_UUID,
  PORTAL_MEASUREMENT_UUID,
  PORTAL_COMMAND_UUID,
  PORTAL_CMD_SHOW_GRAPH,
  PORTAL_CMD_HIDE_GRAPH,
  PORTAL_NAME_PREFIXES,
  PORTAL_PACKET_LENGTH,
  parsePortalMeasurement,
  type PortalMeasurement,
} from '@metic/core/logic/portalProtocol'

// ---------------------------------------------------------------------------
// Minimal Web Bluetooth typings (the DOM lib does not ship them; we avoid a
// dependency on @types/web-bluetooth for a few method signatures).
// ---------------------------------------------------------------------------

interface BtCharacteristic extends EventTarget {
  value?: DataView
  readValue(): Promise<DataView>
  startNotifications(): Promise<BtCharacteristic>
  stopNotifications(): Promise<BtCharacteristic>
  writeValue(value: BufferSource): Promise<void>
  writeValueWithResponse?(value: BufferSource): Promise<void>
}
interface BtService {
  getCharacteristic(uuid: number | string): Promise<BtCharacteristic>
}
interface BtServer {
  connected: boolean
  connect(): Promise<BtServer>
  disconnect(): void
  getPrimaryService(uuid: number | string): Promise<BtService>
}
interface BtDevice extends EventTarget {
  id: string
  name?: string
  gatt?: BtServer
  forget?(): Promise<void>
}
interface BtRequestOptions {
  filters?: Array<{ services?: Array<number | string>; namePrefix?: string }>
  optionalServices?: Array<number | string>
  acceptAllDevices?: boolean
}
interface Bluetooth {
  requestDevice(options: BtRequestOptions): Promise<BtDevice>
  getAvailability?(): Promise<boolean>
}

function bluetoothApi(): Bluetooth | null {
  if (typeof navigator === 'undefined') return null
  return ((navigator as unknown as { bluetooth?: Bluetooth }).bluetooth) ?? null
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface PortalEnvironment {
  /** The page is a secure context (https or localhost). */
  secure: boolean
  /** navigator.bluetooth exists. */
  api: boolean
  /** Adapter available to the browser; null when unknown. */
  adapter: boolean | null
  /** Why the Portal cannot be used here, when it cannot; '' otherwise. */
  reason: 'insecure' | 'no-api' | 'no-adapter' | ''
}

export function bluetoothSupported(): boolean {
  return bluetoothApi() !== null
}

/** Checks that need no device: secure context, API, adapter. */
export async function portalEnvironment(): Promise<PortalEnvironment> {
  const out: PortalEnvironment = {
    secure: typeof window !== 'undefined' && !!window.isSecureContext,
    api: bluetoothSupported(),
    adapter: null,
    reason: '',
  }
  if (!out.secure) out.reason = 'insecure'
  else if (!out.api) out.reason = 'no-api'
  else {
    const bt = bluetoothApi()
    if (bt?.getAvailability) {
      try {
        out.adapter = await bt.getAvailability()
        if (!out.adapter) out.reason = 'no-adapter'
      } catch {
        out.adapter = null
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export type PortalConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'lost' | 'error'

export interface PortalStateEvent {
  state: PortalConnectionState
  name?: string
  error?: string
}

export interface PortalSampleEvent extends PortalMeasurement {
  /** performance.now() when the packet arrived. */
  at: number
  /** Date.now() when the packet arrived. */
  wall: number
}

export type PortalStep = 'device' | 'gatt' | 'service' | 'measurement' | 'command' | 'notify' | 'packet'
export type PortalStepValue = true | false | null | string

const RECONNECT_ATTEMPTS = 6

export class PortalBle extends EventTarget {
  device: BtDevice | null = null
  connected = false
  last: PortalSampleEvent | null = null
  packetCount = 0
  malformedCount = 0
  /** Step → true (ok) | false (failed) | null (pending) | string (note or error). */
  steps: Partial<Record<PortalStep, PortalStepValue>> = {}

  private server: BtServer | null = null
  private measurement: BtCharacteristic | null = null
  private command: BtCharacteristic | null = null
  private wantReconnect = false
  private rateWindow: number[] = []
  private readonly onNotify = (ev: Event) => {
    const target = ev.target as BtCharacteristic | null
    if (target?.value) this.handle(target.value)
  }
  private readonly onDisconnect = () => {
    void this.disconnected()
  }

  get hasCommand(): boolean {
    return this.command !== null
  }

  /** Ask the browser for a Portal. Must be called from a user gesture (click). */
  async pick({ acceptAll = false }: { acceptAll?: boolean } = {}): Promise<BtDevice> {
    const env = await portalEnvironment()
    if (env.reason === 'insecure') throw new Error('Web Bluetooth needs a secure page: open Metic over https or at http://localhost.')
    if (env.reason === 'no-api') throw new Error('This browser has no Web Bluetooth. Use Google Chrome or Microsoft Edge.')
    const bt = bluetoothApi()!
    const request: BtRequestOptions = acceptAll
      ? { acceptAllDevices: true, optionalServices: [PORTAL_SERVICE_UUID] }
      : {
          filters: [{ services: [PORTAL_SERVICE_UUID] }, ...PORTAL_NAME_PREFIXES.map((namePrefix) => ({ namePrefix }))],
          optionalServices: [PORTAL_SERVICE_UUID],
        }
    const device = await bt.requestDevice(request)
    this.device = device
    this.step('device', device.name || '(unnamed device)')
    device.addEventListener('gattserverdisconnected', this.onDisconnect)
    this.wantReconnect = true
    await this.connect()
    return device
  }

  async connect(): Promise<void> {
    const device = this.device
    if (!device?.gatt) throw new Error('No Portal selected yet.')
    this.emit('state', { state: 'connecting' })
    for (const k of ['gatt', 'service', 'measurement', 'command', 'notify', 'packet'] as PortalStep[]) this.step(k, null)
    try {
      this.server = await device.gatt.connect()
      this.step('gatt', true)
      const service = await this.server.getPrimaryService(PORTAL_SERVICE_UUID)
      this.step('service', true)
      this.measurement = await service.getCharacteristic(PORTAL_MEASUREMENT_UUID)
      this.step('measurement', true)
      try {
        this.command = await service.getCharacteristic(PORTAL_COMMAND_UUID)
        this.step('command', true)
      } catch {
        this.command = null // older firmware may not expose it
        this.step('command', 'not exposed by this firmware')
      }
      try {
        this.handle(await this.measurement.readValue())
      } catch {
        /* some stacks refuse a read before notifications start; fine */
      }
      this.measurement.addEventListener('characteristicvaluechanged', this.onNotify)
      await this.measurement.startNotifications()
      this.step('notify', true)
      this.connected = true
      this.emit('state', { state: 'connected', name: device.name || 'Belka Portal' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failed = (['gatt', 'service', 'measurement', 'notify'] as PortalStep[]).find((k) => this.steps[k] === null) ?? 'gatt'
      this.step(failed, message)
      this.connected = false
      this.emit('state', { state: 'error', error: message })
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.wantReconnect = false
    try {
      if (this.measurement) {
        this.measurement.removeEventListener('characteristicvaluechanged', this.onNotify)
        await this.measurement.stopNotifications().catch(() => {})
      }
    } finally {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect()
      this.connected = false
      this.emit('state', { state: 'disconnected' })
    }
  }

  /** Drop the browser's pairing permission for this device too. */
  async forget(): Promise<void> {
    await this.disconnect()
    const device = this.device
    this.device = null
    try {
      await device?.forget?.()
    } catch {
      /* not supported on this browser; the permission expires on its own */
    }
  }

  /** Write one of the known 4-byte commands; resolves when the Portal acknowledges it. */
  async writeCommand(payload: readonly number[]): Promise<void> {
    if (!this.connected || !this.command) throw new Error('Portal command characteristic is not available.')
    const bytes = Uint8Array.from(payload)
    if (this.command.writeValueWithResponse) await this.command.writeValueWithResponse(bytes)
    else await this.command.writeValue(bytes)
  }

  showGraph(): Promise<void> {
    return this.writeCommand(PORTAL_CMD_SHOW_GRAPH)
  }

  hideGraph(): Promise<void> {
    return this.writeCommand(PORTAL_CMD_HIDE_GRAPH)
  }

  /** Notifications per second over the last ~5 s. */
  packetRate(): number {
    const now = performance.now()
    this.rateWindow = this.rateWindow.filter((t) => now - t < 5000)
    return this.rateWindow.length / 5
  }

  private handle(view: DataView): void {
    const m = parsePortalMeasurement(view)
    if (!m || ![m.ec, m.tInt, m.tOut].every(Number.isFinite)) {
      this.malformedCount++
      this.step('packet', `unexpected packet (${view.byteLength} B, expected ${PORTAL_PACKET_LENGTH})`)
      this.emit('malformed', { byteLength: view.byteLength })
      return
    }
    const now = performance.now()
    this.packetCount++
    this.rateWindow.push(now)
    if (this.steps.packet !== true) this.step('packet', true)
    this.last = { ...m, at: now, wall: Date.now() }
    this.emit('measurement', this.last)
  }

  private async disconnected(): Promise<void> {
    this.connected = false
    this.step('gatt', false)
    this.emit('state', { state: 'disconnected' })
    if (!this.wantReconnect) return
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS && this.wantReconnect; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      if (!this.wantReconnect) return
      try {
        await this.connect()
        return
      } catch {
        /* keep trying */
      }
    }
    this.emit('state', { state: 'lost' })
  }

  private step(name: PortalStep, value: PortalStepValue): void {
    this.steps[name] = value
    this.emit('step', { name, value, steps: { ...this.steps } })
  }

  private emit(type: 'state', detail: PortalStateEvent): void
  private emit(type: 'measurement', detail: PortalSampleEvent): void
  private emit(type: 'malformed', detail: { byteLength: number }): void
  private emit(type: 'step', detail: { name: PortalStep; value: PortalStepValue; steps: PortalBle['steps'] }): void
  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

/** The one Portal this browser talks to. */
export const portalBle = new PortalBle()
