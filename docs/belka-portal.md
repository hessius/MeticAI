# Belka Portal — conductivity alongside every shot

The [Belka Portal](https://www.belkacoffee.com) is a small Bluetooth sensor that sits under the portafilter and measures the **electrical conductivity (EC)** and temperature of the espresso as it flows into the cup, about eight times a second. Metic can record that stream next to the Meticulous' own telemetry for every shot, show how conductivity evolved over the pour, and — once you have paired a few shots with refractometer readings — estimate TDS and extraction yield for the shots you did not measure.

> **What the Portal measures.** EC is a *concentration proxy*: it tracks dissolved ions, while a refractometer tracks everything dissolved. The two are related by a ratio that is specific to a coffee, a water and a Portal mounting, so Metic never shows EC *as* TDS. It shows the EC analysis on its own, and only produces a TDS estimate from a calibration you build with your own refractometer, flagged with how much to trust it.

## Requirements

- **Chrome or Edge on a computer or Android device.** The Portal is reached over [Web Bluetooth](https://developer.mozilla.org/docs/Web/API/Web_Bluetooth_API), which Safari and the iOS/Android app shells do not provide.
- **A secure page.** Web Bluetooth only works on `https://` origins or on `http://localhost`. If you open Metic at a plain `http://192.168.x.x:3550` address, the Portal section explains this and the Connect button stays disabled. Three ways to get a secure page:
  - open Metic at `http://localhost:3550` on the computer that runs the container (Chrome there also needs Bluetooth access);
  - use the built-in [Tailscale](../TAILSCALE.md) integration, which serves Metic over HTTPS;
  - for testing only, allow the origin under `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
- **On macOS**, Chrome needs Bluetooth permission: *System Settings → Privacy & Security → Bluetooth → Google Chrome*.
- **Close the Belka phone app** before connecting; the Portal accepts one connection at a time.

## Using it

1. **Settings → Belka Portal → Record the Portal during shots.** Then *Connect over Bluetooth* and pick the Portal in Chrome's chooser. The connection check under the button turns each step green (device, GATT, service `0x7400`, measurement `0x7410`, command `0x7420`, notifications, 13-byte packets). If the chooser lists nothing, tick *Show every nearby Bluetooth device*.
2. **Pull a shot.** The live shot view gains a third row of tiles: Portal EC, outlet temperature, and the recorder state. Recording starts when the machine reports `brewing`, continues for the settle window after the pump stops (drips), and is then attached to the shot the machine has just saved. If the Portal's screen is set to show its graph during a shot, Metic sends that command at the start and reverts it afterwards.
3. **Open the shot** under Shot History. Below the notes, the **Belka Portal** panel shows conductivity against cup mass with the running integral ∫EC dm, the metrics (mean EC per gram, ∫EC dm, peak EC and where it happened, Portal coverage of the cup mass, first drop, mean outlet temperature, mass at 90 % of the integral, share of the integral from the last 5 g), a **Coffee** label and dose, the **estimate**, and the **refractometer reading** fields.
4. **Type the refractometer reading** for the cups you measure. Each reading becomes a calibration point for that coffee. From five readings the estimate stops being flagged *preliminary*; inside the measured EC range it is trustworthy, outside it is flagged *extrapolated*.
5. **Estimate from** chooses what an estimate may borrow: *auto* uses this coffee if it has readings, else all coffees (flagged), *this coffee only* refuses to borrow, *all coffees* pools everything.

The *Coffee* label groups calibration (case- and whitespace-insensitive) and is remembered as the default for the next shot, so keep it stable while you work through a bag.

## What is stored, and where

Recordings are stored by the shared core under `platform.storage.portalShots`, keyed by `{date}/{filename}` like shot annotations:

- **Server mode** (Docker): `/data/portal_shots.json` with the JSON backend, or the `portalShots` collection with SQLite. Existing installs that switch to SQLite are migrated like the other keyed-map files.
- **Direct/native mode**: the `portal_shots` IndexedDB store in the browser.

Each record holds the raw samples (`t` seconds from shot start on the machine's clock, `ec`, `tOut`, `tInt`, `status`), the anchor time, the lag and stop time, the coffee label, dose, the refractometer reading (with its extraction yield) and a cached analysis summary. Nothing leaves the device except the request to your own Metic server.

## How the numbers are made

The core (`packages/core/src/logic/portalAnalysis.ts`) pairs the EC stream with the machine's cup-weight curve from the shot's own record (`/api/shots/data/{date}/{filename}`):

- The weight curve is made monotone (running maximum) so scale noise never lowers cumulative mass.
- Every scale sample and every Portal sample (shifted by the lag setting) becomes a knot carrying interpolated mass and EC. Trapezoidal integration in cumulative-mass space gives **∫EC dm**; divided by the mass the Portal actually covered it gives **mean EC per gram**, the number calibration uses.
- Gaps in the Portal stream (> 1 s) are not integrated across and lower *coverage*; below 85 % coverage the shot is marked *low coverage* and its reading is not used as a reference.
- **Calibration** fits `TDS = k · meanEcPerG` (through the origin: pure water has neither EC nor TDS) with leave-one-out error. An affine model is only considered with five or more points spread over a real EC range, and only used when it clearly wins out of sample. A shot's own reading is left out of the fit used to estimate it.

The method follows the Decenza project's Portal calibration work and is a TypeScript port of [portal-met-bridge](https://github.com/privaterra/portal-met-bridge) (MIT), a standalone logger for the same pairing. The BLE protocol (service `0x7400`, 13-byte little-endian packets: EC f32, internal °C f32, outlet °C f32, status u8; commands `40 00 01 2D` show graph / `40 00 01 2E` hide) comes from the `variegated-belka-portal-trouble-driver` crate in [variegated-rs](https://github.com/variegated-coffee/variegated-rs), cross-checked against Decenza.

## Timing

The Portal and the machine never talk to each other. When the machine first reports `brewing`, Metic fixes `anchor = now − shot_timer` and stamps every Portal packet relative to it, so both streams share the machine's clock. The **Portal lead vs. cup** setting (seconds) corrects for liquid reaching the Portal before the scale registers it; a positive value shifts the EC curve later against the cup mass. Start at 0 and adjust if the EC peak lands visibly before the first grams in the cup.

## Recovery

A finished recording is matched to the machine's most recent saved shot (`/api/last-shot`) by start time (±2 minutes), polling for up to 30 seconds while the machine writes the shot file. If no match appears (machine unreachable, shot not saved), the recording is parked in the browser's localStorage and attached the next time the machine connects, for up to seven days. Recordings shorter than ten samples — the Portal was not connected, or the machine flushed — are discarded.

## Limitations

- Capture happens in the browser tab that is paired with the Portal; keep it open while brewing. Nothing is captured from a phone or from the iOS/Android app.
- One Portal per browser; the pairing is Chrome's and survives reloads, but a different browser or device has to pair again.
- The status byte's meaning (battery?) is not documented; it is stored but not interpreted.
- Everything about EC → TDS is empirical. Keep the same Portal, water and mounting while you collect references, and expect the ratio to shift between coffees.
