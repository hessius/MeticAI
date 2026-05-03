# Metic — App Review Information

## 1. Screen Recording

A screen recording captured on a physical iPhone is attached via App Store Connect. The recording demonstrates:

- App launch and onboarding flow
- Machine discovery (auto-detection via mDNS on local network)
- AI profile generation from a text description
- Browsing the profile catalogue
- Shot history and shot analysis
- Pour-over brewing guide
- Settings and configuration
- Demo mode activation

---

## 2. App Purpose & Value

**What Metic does:**

Metic is a companion app for the [Meticulous Espresso Machine](https://www.meticulousespresso.com) — a high-end home espresso machine with programmable extraction profiles. The Meticulous machine supports custom profiles that control pressure, flow, and temperature across multiple extraction phases, but creating these profiles manually requires deep coffee science knowledge.

**The problem it solves:**

Creating optimal extraction profiles for the Meticulous machine is complex and intimidating for most users. Metic uses Google Gemini AI to bridge this gap — users describe their desired coffee experience in plain language (e.g., "a bright, fruity shot with a long bloom phase") and Metic generates a complete, ready-to-brew profile with all parameters configured.

**Value for users:**

- **Beginners**: Get great espresso immediately without understanding extraction science
- **Enthusiasts**: Explore new profiles quickly and iterate with AI-assisted dial-in
- **Everyone**: Track shot history, analyze extraction quality, and improve over time

**Key functionality:**
- AI-powered profile generation from text descriptions or coffee bean photos
- Direct machine control over local Wi-Fi (start/stop shots, load profiles)
- Real-time shot monitoring with live pressure, flow, and temperature telemetry
- Shot history with detailed graphs and AI-powered analysis
- Espresso Compass for dial-in guidance
- Pour-over brewing timer and recipe guide
- Profile library management

---

## 3. Instructions for Reviewing the App

### Accessing Demo Mode (no hardware required)

The app requires a Meticulous Espresso Machine on the local network for full functionality. For review without hardware:

1. Launch the app
2. Complete onboarding (or go to **Settings**)
3. In the **Machine IP** field, enter: `demo`
4. The app enters demo mode with simulated machine data

Demo mode provides:
- 6 pre-built example profiles
- 10 simulated shot records with realistic telemetry data
- Simulated machine status and connectivity
- A visible "Demo Mode" banner so it's clear the data is simulated

### Core Features Walkthrough

| Feature | How to Access |
|---------|---------------|
| **AI Profile Generation** | Home screen → "Create Profile" button → describe your coffee → tap Generate |
| **Profile Catalogue** | Home screen → "Profile Catalogue" button |
| **Shot History** | Home screen → "Shot History" button |
| **Shot Analysis** | Open any shot from history → tap analysis tab |
| **Pour-Over** | Home screen → "Pour Over" button |
| **Espresso Compass** | Home screen → "Espresso Compass" button |
| **Settings** | Home screen → gear icon (top right) |
| **Live Shot** | With a connected machine: load a profile → start shot |

### AI Features

AI profile generation and shot analysis require a Google Gemini API key. This is **optional** — the app functions fully without it (profile browsing, shot history, machine control, pour-over all work without AI).

To test AI features:
1. Go to **Settings** → **AI Configuration**
2. Enter a valid Google Gemini API key (free tier available at https://aistudio.google.com/app/apikey)
3. Return to home → "Create Profile" → enter a description → Generate

If no API key is configured, AI-dependent features show a prompt explaining how to add one.

### Login Credentials

**None required.** The app has no user accounts, no login system, and no registration flow. All data is stored locally on the device.

---

## 4. External Services, Tools & Platforms

| Service | Purpose | Data Sent |
|---------|---------|-----------|
| **Google Gemini API** (generative AI) | AI profile generation, shot analysis, dial-in suggestions, profile image generation | Coffee preferences, brewing parameters, shot data. **No personally identifiable information.** |
| **Meticulous Machine** (local network) | Direct machine control, real-time telemetry, profile upload | Brewing profiles, start/stop commands. All communication over local Wi-Fi only — no internet required. |

**Services NOT used:**
- ❌ No cloud backend or relay server (all communication is device-to-machine on LAN)
- ❌ No analytics services (no Firebase, Mixpanel, etc.)
- ❌ No advertising SDKs
- ❌ No payment processing (app is free, no in-app purchases)
- ❌ No third-party authentication services
- ❌ No social media integration
- ❌ No crash reporting services

**Technical frameworks:**
- Capacitor (Ionic) — native iOS shell for the web app
- Socket.IO — real-time communication with the Meticulous machine over local network

---

## 5. Regional Differences

**The app functions consistently across all regions.** There are no regional feature differences, content restrictions, or geo-locked functionality.

The app supports 6 languages:
- English (default)
- Swedish
- German
- Spanish
- French
- Italian

Language is auto-detected from device settings or manually selectable in the app. All features are identical regardless of language or region.

The Meticulous Espresso Machine is sold globally and the app works with any unit on any network worldwide.

---

## 6. Regulated Industry

**Not applicable.** The app operates in the consumer electronics / food & drink category. It is a companion controller for a home espresso machine. It does not:
- Dispense medical advice
- Process financial transactions
- Handle health data
- Operate in a regulated industry

No special licenses, certifications, or regulatory documentation is required.

---

## Additional Notes

### Privacy

- **No data collection**: The app does not collect, store, or transmit any user data to external servers
- **No tracking**: No analytics, no advertising identifiers, no device fingerprinting
- **Local-first**: All brewing data (profiles, shot history) is stored exclusively on the user's device
- **AI requests**: When the user explicitly triggers AI generation, only coffee-related parameters are sent to Google Gemini. No PII is included.
- **No accounts**: No registration, no passwords, no personal data stored

### Device Permissions

| Permission | Purpose | When Triggered |
|------------|---------|----------------|
| **Local Network** | Discover and communicate with the Meticulous machine via mDNS/HTTP/WebSocket | On first launch or when scanning for machines |
| **Camera** (optional) | Scan QR codes for machine discovery; capture coffee bean photos for AI profile generation | Only when user explicitly taps camera button |

### Offline Capability

The app works partially offline:
- Profile browsing, shot history, settings — fully offline
- Machine control — requires local network (no internet)
- AI features — require internet for Google Gemini API calls

---

## App Store Connect Review Notes (copy-paste ready)

> This app is a companion controller for the Meticulous Espresso Machine. It communicates directly with the machine over local Wi-Fi — no cloud backend required.
>
> **Demo mode**: Enter "demo" as the Machine IP in Settings to review all features without hardware.
>
> **No login required** — the app has no user accounts.
>
> **AI features are optional** — they require a free Google Gemini API key (https://aistudio.google.com/app/apikey). Without a key, all non-AI features work normally.
>
> **External services**: Google Gemini API only (user-provided key, optional). No analytics, ads, payments, or cloud services.
>
> **No regional differences** — identical functionality worldwide in 6 languages.
>
> A screen recording demonstrating the full user flow is attached.
