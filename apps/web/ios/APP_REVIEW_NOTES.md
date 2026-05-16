Copy-paste for App Store Connect Review Notes field (plain text, <4000 chars):

---

1. SCREEN RECORDING

A screen recording on a physical iPhone is attached. It demonstrates: app launch, onboarding, machine discovery via mDNS, AI profile creation, profile catalogue, shot history with AI analysis, pour-over guide, settings, and demo mode.

2. APP PURPOSE

Metic is a companion app for the Meticulous Espresso Machine (meticulousespresso.com) — a programmable home espresso machine. The machine uses custom extraction profiles that control pressure, flow, and temperature across multiple brewing phases.

Metic solves the complexity of profile creation: users describe their desired coffee in plain language (e.g. "a bright, fruity shot with a long bloom") and Google Gemini AI generates a complete, ready-to-brew profile. The app also provides shot history tracking, AI-powered extraction analysis, dial-in guidance, and a pour-over brewing timer.

3. REVIEW INSTRUCTIONS

No login required — the app has no user accounts. All data is stored locally on device.

Demo mode (no hardware needed):
- Launch the app and complete onboarding
- In Settings, enter "demo" as Machine IP
- The app loads simulated data: 6 profiles, 10 shot records, simulated machine status
- A "Demo Mode" banner is shown throughout

Feature walkthrough from the home screen:
- Create Profile: AI profile generation from text description
- Profile Catalogue: browse and load profiles
- Shot History: view past shots with graphs
- Shot Analysis: open any shot, tap the analysis tab
- Pour Over: guided pour-over timer
- Espresso Compass: dial-in guidance tool
- Settings: gear icon (top right)

AI features (optional): require a Google Gemini API key. A free key is available at https://aistudio.google.com/app/apikey — enter it in Settings > AI Configuration. Without a key, all non-AI features work normally and AI features show a prompt explaining how to add one.

4. EXTERNAL SERVICES

Google Gemini API (optional, user-provided key): Used for AI profile generation, shot analysis, and profile image generation. Only coffee-related parameters are sent — no personally identifiable information.

Meticulous machine (local network only): Direct communication over Wi-Fi via mDNS/HTTP/WebSocket for machine control and real-time telemetry. No internet required.

No cloud backend, no analytics, no ads, no payments, no third-party auth, no crash reporting, no social media SDKs. Built with Capacitor (native iOS shell) and Socket.IO (local machine communication).

5. REGIONAL DIFFERENCES

None. The app functions identically worldwide. Supports 6 languages (English, Swedish, German, Spanish, French, Italian) auto-detected from device settings.

6. REGULATED INDUSTRY

Not applicable. Consumer electronics / food & drink category. No medical, financial, or health data processing.

DEVICE PERMISSIONS:
- Local Network: discover and communicate with the Meticulous machine on LAN
- Camera (optional): scan coffee bean photos for AI profile generation, triggered only by explicit user action

PRIVACY: No data collection, no tracking, no advertising identifiers. All brewing data stored locally on device. AI requests contain only coffee parameters, no PII.
