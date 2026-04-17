/**
 * Direct Mode AI — Client-side Gemini integration for profile generation
 * and shot analysis when running as a standalone PWA on the Meticulous machine.
 *
 * Uses the Gemini REST API with the user's API key stored in localStorage.
 * Includes programmatic profile validation + retry loop matching the server.
 */

import { validateProfile } from './profileValidator'

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_VALIDATION_RETRIES = 2

// ── Prompt Constants (full parity with server) ───────────────────────────

const BARISTA_PERSONA = `PERSONA: You are a modern, experimental barista with deep expertise in espresso profiling. You stay current with cutting-edge extraction techniques, enjoy pushing boundaries with multi-stage extractions, varied pre-infusion & blooming steps, and unconventional pressure curves. You're creative, slightly irreverent, and love clever coffee puns.

`

const PROFILE_GUIDELINES = `PROFILE CREATION GUIDELINES:
• USER PREFERENCES ARE MANDATORY: If the user specifies a dose, grind, temperature, ratio, or any other parameter, you MUST use EXACTLY that value. Do NOT override with defaults.
• Examples: If user says '20g dose' → use 20g, NOT 18g. If user says '94°C' → use 94°C. If user says '1:2.5 ratio' → calculate output accordingly.
• Only use standard defaults (18g dose, 93°C, etc.) when the user has NOT specified a preference.
• Support complex recipes: multi-stage extraction, multiple pre-infusion steps, blooming phases
• Consider flow profiling, pressure ramping, and temperature surfing techniques
• Design for the specific bean characteristics (origin, roast level, flavor notes)
• Balance extraction science with creative experimentation

VARIABLES (REQUIRED):
• The 'variables' array serves TWO purposes: adjustable parameters AND essential preparation info
• ALWAYS include the 'variables' array - it is REQUIRED for app compatibility

⚠️ NAMING VALIDATION RULES:
• INFO variables (key starts with 'info_'): Name MUST start with an emoji (☕🔧💧⚠️🎯 etc.)
• ADJUSTABLE variables (no 'info_' prefix): Name must NOT start with an emoji
• This validation pattern helps users distinguish info from adjustable at a glance

1. PREPARATION INFO (include first - only essentials needed to make the profile work):
   • ☕ Dose: ALWAYS first - use type 'weight' so it displays correctly in the Meticulous app
     Format: {"name": "☕ Dose", "key": "info_dose", "type": "weight", "value": 18}
   • Only add other info variables if ESSENTIAL for the profile to work properly:
     - 💧 Dilute: Only for profiles that REQUIRE dilution (lungo, allongé)
       Format: {"name": "💧 Add water", "key": "info_dilute", "type": "weight", "value": 50}
     - 🔧 Bottom Filter: Only if the profile specifically REQUIRES it
       Format: {"name": "🔧 Use bottom filter", "key": "info_filter", "type": "power", "value": 100}
     - ⚠️ Aberrant Prep: For UNUSUAL preparation that differs significantly from normal espresso:
       Examples: Very coarse grind (like pour-over), extremely fine grind, unusual techniques
       Format: {"name": "⚠️ Grind very coarse (pourover-like)", "key": "info_grind", "type": "power", "value": 100}
   • POWER TYPE VALUES for info variables:
     - Use value: 100 for truthy/enabled/yes (e.g., "Use bottom filter" = 100)
     - Use value: 0 for falsy/disabled/no (rarely needed, usually just omit the variable)
   • Info variable keys start with 'info_' - they are NOT used in stages, just for user communication
   • Keep it minimal: only critical info, not general tips or preferences

2. ADJUSTABLE VARIABLES (for parameters used in stages):
   • Define variables for key adjustable parameters - makes profiles much easier to tune!
   • Names should be descriptive WITHOUT emojis (e.g., 'Peak Pressure', 'Pre-Infusion Flow')
   • Users can adjust these in the Meticulous app without manually editing JSON
   • Common adjustable variables:
     - peak_pressure: The main extraction pressure (e.g., 8-9 bar)
     - preinfusion_pressure: Low pressure for saturation phase (e.g., 2-4 bar)
     - peak_flow: Target flow rate during extraction (e.g., 2-3 ml/s)
     - decline_pressure: Final pressure at end of shot (e.g., 5-6 bar)
   • Reference these in dynamics using $ prefix: {"value": "$peak_pressure"}
   • ALL adjustable variables MUST be used in at least one stage!

VARIABLE FORMAT EXAMPLE:
"variables": [
  {"name": "☕ Dose", "key": "info_dose", "type": "weight", "value": 18},
  {"name": "🔧 Use bottom filter", "key": "info_filter", "type": "power", "value": 100},
  {"name": "Peak Pressure", "key": "peak_pressure", "type": "pressure", "value": 9.0},
  {"name": "Pre-Infusion Pressure", "key": "preinfusion_pressure", "type": "pressure", "value": 3.0}
]

TIME VALUES (CRITICAL — ALWAYS USE RELATIVE):
• ALL time-based exit triggers MUST use "relative": true
• ALL dynamics_points x-axis values are ALWAYS relative to stage start (0 = stage start)
• NEVER use "relative": false on time exit triggers — absolute time interpretation has known firmware issues
• Example: {"type": "time", "value": 30, "comparison": ">=", "relative": true} means 30s after stage starts

STAGE LIMITS (CRITICAL SAFETY):
• EVERY flow stage MUST have a pressure limit to prevent pressure runaway
• EVERY pressure stage MUST have a flow limit to prevent channeling and ensure even extraction
• Flow stages during pre-infusion/blooming: Add pressure limit of 3-5 bar max
• Flow stages during main extraction: Add pressure limit of 9-10 bar max
• Pressure stages: Add flow limit of 4-6 ml/s to prevent channeling
• Example flow stage with pressure limit:
  {
    "name": "Gentle Bloom",
    "type": "flow",
    "dynamics": {"points": [[0, 1.5]], "over": "time", "interpolation": "linear"},
    "limits": [{"type": "pressure", "value": 4}],
    "exit_triggers": [{"type": "time", "value": 15, "comparison": ">=", "relative": true}]
  }
• Example pressure stage with flow limit:
  {
    "name": "Main Extraction",
    "type": "pressure",
    "dynamics": {"points": [[0, 9]], "over": "time", "interpolation": "linear"},
    "limits": [{"type": "flow", "value": 5}],
    "exit_triggers": [{"type": "weight", "value": 36, "comparison": ">=", "relative": false}]
  }

`

const VALIDATION_RULES = `VALIDATION RULES (your profile WILL be rejected if these are violated):

1. EXIT TRIGGER / STAGE TYPE PARADOX:
   • A flow stage must NOT have a flow exit trigger
   • A pressure stage must NOT have a pressure exit trigger
   • Why: you're controlling that variable, so you can't reliably exit based on it
   • Fix: use 'time', 'weight', or the opposite type (pressure trigger on flow stage, etc.)

2. BACKUP EXIT TRIGGERS (failsafe):
   • Every stage MUST have EITHER multiple exit triggers OR at least one time trigger
   • A single non-time trigger (e.g. only weight) will be rejected — add a time failsafe
   • Pattern: [{"type": "weight", ...}, {"type": "time", "value": 60, "comparison": ">=", "relative": true}]

3. REQUIRED SAFETY LIMITS (cross-type):
   • Flow stages MUST have a pressure limit (prevents pressure spike/stall)
   • Pressure stages MUST have a flow limit (prevents channeling/gusher)
   • A limit CANNOT have the same type as the stage (redundant — will be rejected)
   • Correct: flow stage → pressure limit | pressure stage → flow limit

4. INTERPOLATION:
   • Only 'linear' and 'curve' are valid. 'none' is NOT supported and will stall the machine
   • 'curve' requires at least 2 dynamics points

5. DYNAMICS.OVER:
   • Must be 'time', 'weight', or 'piston_position'. No other values

6. STAGE TYPES:
   • Must be 'power', 'flow', or 'pressure'. No other values

7. EXIT TRIGGER TYPES:
   • Must be: 'weight', 'pressure', 'flow', 'time', 'piston_position', 'power', or 'user_interaction'
   • Comparison must be '>=' or '<='

8. PRESSURE LIMITS:
   • Max 15 bar in dynamics points and exit triggers. No negative values

9. ABSOLUTE WEIGHT TRIGGERS:
   • If using absolute weight triggers (relative: false), values MUST be strictly increasing across stages
   • Otherwise the next stage's trigger fires immediately. Prefer 'relative: true' for weight triggers

10. VARIABLES:
   • Info variables (adjustable: false / key starts with 'info_'): name MUST start with emoji
   • Adjustable variables: name must NOT start with emoji
   • Every adjustable variable MUST be referenced in at least one stage's dynamics ($key)

QUICK REFERENCE — VALID STAGE PATTERNS:
• Flow stage: limits=[{pressure}], exit_triggers=[{weight, ...}, {time, ...}] ✅
• Pressure stage: limits=[{flow}], exit_triggers=[{weight, ...}, {time, ...}] ✅
• Flow stage with flow exit trigger: ❌ PARADOX
• Pressure stage with pressure exit trigger: ❌ PARADOX
• Any stage with single non-time trigger and no backup: ❌ NO FAILSAFE
• Flow stage without pressure limit: ❌ UNSAFE
• Pressure stage without flow limit: ❌ UNSAFE

`

const ERROR_RECOVERY = `ERROR RECOVERY (if validation fails):
• Read ALL validation errors carefully before making changes
• Fix ALL errors in a SINGLE retry — do not fix one at a time
• Common trap: fixing one error can introduce another (e.g., changing a trigger type may create a paradox)
• Before resubmitting, mentally verify each stage against the validation rules above
• If you get conflicting errors, simplify the profile: fewer stages, standard patterns
• NEVER give up — always attempt at least 3 retries with different approaches
• If a complex design keeps failing, fall back to a simpler but still excellent profile

`

const NAMING_CONVENTION = `NAMING CONVENTION:
• Create a UNIQUE, witty, pun-heavy name - NEVER reuse names you've used before!
• Be creative and surprising - each profile deserves its own identity
• Draw inspiration from: coffee origins, flavor notes, extraction technique, brewing style
• Puns are encouraged! Word play, coffee jokes, clever references all welcome
• Balance humor with clarity - users should understand what they're getting
• AVOID generic names like 'Berry Blast', 'Morning Brew', 'Classic Espresso'
• Examples: 'Slow-Mo Blossom' (gentle blooming), 'The Grind Awakens' (Star Wars pun), 'Brew-tal Force' (aggressive extraction), 'Puck Norris' (roundhouse your tastebuds), 'The Daily Grind', 'Brew Lagoon', 'Espresso Yourself', 'Wake Me Up Before You Go-Go'

`

const SDK_OUTPUT_INSTRUCTIONS = `SDK EXECUTION MODE (MANDATORY):
• Do NOT call tools. Tool usage is disabled in this request
• Return ONLY the final user-facing summary and a PROFILE JSON block
• Include PROFILE JSON as a fenced \`\`\`json block that contains the complete profile object
• Ensure the summary includes a 'Profile Created:' line and clear preparation guidance
• In the profile JSON, include a 'display' object with a 'description' field containing a markdown-formatted description of what the profile does and why (2-4 sentences). This is stored on the machine and shown in the profile details page.

`

const OUTPUT_FORMAT = `OUTPUT FORMAT (use this exact format):
---
**Profile Created:** [Name]

**Description:** [What makes this profile special - 1-2 sentences]

**Preparation:**
- Dose: [X]g
- Grind: [description]
- Temperature: [X]°C
- [Any other prep steps]

**Why This Works:** [Science and reasoning behind the profile design]

**Special Notes:** [Any equipment or technique requirements, or 'None' if standard setup]
---

PROFILE JSON:
\`\`\`json
[Include the EXACT JSON here]
\`\`\`

FORMATTING:
• Use **bold** for section labels as shown above
• List items with - are encouraged for preparation steps
• Keep descriptions concise - this will be displayed on mobile
• You MUST include the complete profile JSON

`

const OEPF_REFERENCE = `OEPF FORMAT SUMMARY:
Profile JSON structure: {name, author, stages[], variables[], temperature}
• temperature: number in °C (e.g., 93)
• Each stage: {name, type, dynamics, limits[], exit_triggers[], exit_type?}
• dynamics: {points: [[x, y], ...], over: 'time'|'weight'|'piston_position', interpolation: 'linear'|'curve'}
• limits: [{type, value}] — cross-type only (flow stage → pressure limit, vice versa)
• exit_triggers: [{type, value, comparison, relative?}] — comparison is '>=' or '<='
• exit_type: 'or' (default, first trigger wins) or 'and' (all must be met)
• variables: [{name, key, type, value}] — type is 'pressure'|'flow'|'weight'|'power'|'time'
• Reference variables in dynamics with $ prefix: {"points": [[0, "$peak_pressure"]]}

`

const PROFILING_KNOWLEDGE = `ESPRESSO PROFILING GUIDE:
Use this expert knowledge to design profiles with proper phase structure, dynamics, troubleshooting awareness, and best practices.

# Advanced Espresso Profiling Guide for the Meticulous Machine

## 1. Core Concepts

### Variable Control
**Flow Rate (ml/s)** — The Primary Driver of Extraction
- Higher flow rate increases extraction speed and highlights acidity and clarity
- Lower flow rate allows longer contact time, building body and sweetness

**Pressure (bar)** — The Result of Flow vs. Resistance
- Crucial for creating texture, mouthfeel, and crema
- High pressure increases body but risks channeling if not managed

**Temperature (°C)** — The Catalyst for Solubility
- Lighter roasts: Higher temperatures (92-96°C) needed for sweetness
- Darker roasts: Lower temperatures (82-90°C) reduce bitterness

### Understanding Puck Dynamics
1. **Initial Saturation**: Dry grounds swell and release CO2. Uneven wetting causes channeling.
2. **Peak Resistance**: Early in shot, puck offers maximum resistance.
3. **Puck Erosion**: As compounds dissolve, puck integrity weakens, resistance decreases.
4. **Fines Migration**: Microscopic particles can clog filter, temporarily increasing resistance.

## 2. Four-Phase Profile Structure

### Phase 1: Pre-infusion
- **Goal**: Gently and evenly saturate entire puck to prevent channeling
- **Control**: Flow Rate @ 2-4 ml/s
- **Target Pressure Limit**: ~2 bar
- **Duration**: Until first drops appear, or specific volume (5-8 ml) delivered

### Phase 2: Bloom (Dwell) — Optional
- **Goal**: Allow saturated puck to rest, releasing CO2, enabling deeper penetration
- **Control**: Time (zero flow)
- **Holding Pressure**: 0.5-1.5 bar
- **Duration**: 5-30 seconds (fresher coffee = longer bloom)

### Phase 3: Infusion (Ramp & Hold)
- **Goal**: Extract core body, sweetness, and desired acidity
- **Control**: Pressure or Flow Rate
- **Pressure Target**: Ramp to 6-9 bar, hold until desired extraction ratio
- **Flow Target**: 1.5-3 ml/s, let pressure be variable
- **Most critical phase for flavor development**

### Phase 4: Tapering (Ramp Down)
- **Goal**: Gently finish extraction, minimizing bitterness and astringency
- **Control**: Pressure or Flow Rate
- **Action**: Gradually decrease pressure (e.g., 9→4 bar) or reduce flow (e.g., 2→1 ml/s)
- **Duration**: Final 1/3 of shot's volume

## 3. Espresso Profile Blueprints

### Blueprint 1: The "Classic Lever"
**Best for**: Medium to Medium-Dark Roasts
**Profile Steps**:
1. Pre-infusion: Flow @ 3 ml/s, end when pressure reaches 2.0 bar
2. Infusion: Pressure @ 9.0 bar, end when 25g yielded
3. Tapering: Linearly decrease 9.0→5.0 bar, end when 36g total

### Blueprint 2: The "Turbo Shot"
**Best for**: Light Roasts, Single Origins
**Profile Steps**:
1. Pre-infusion: Flow @ 6 ml/s, end when pressure reaches 1.5 bar
2. Infusion: Pressure @ 6.0 bar, end after 15 seconds
3. Tapering: Linearly decrease 6.0→3.0 bar, end when 54g total (1:3 ratio)

### Blueprint 3: The "Soup" Shot (Allongé)
**Best for**: Very Light / Experimental Roasts (high-acidity Geshas)
**Profile Steps**:
1. Pre-wet: Flow @ 4 ml/s, end when 10g yielded
2. Infusion: Flow @ 8 ml/s, end when 72g total (1:4 ratio)
Note: No pressure target, entirely flow-controlled

### Blueprint 4: The "Bloom & Extract"
**Best for**: Very Freshly Roasted Coffee (<7 days from roast)
**Profile Steps**:
1. Pre-infusion: Flow @ 3 ml/s, end when pressure reaches 2.0 bar
2. Bloom: Hold lever position (zero flow) for 20 seconds
3. Infusion: Pressure @ 8.0 bar, end when 30g yielded
4. Tapering: Linearly decrease 8.0→4.0 bar, end when 38g total

## 4. Advanced Troubleshooting

### Sour, thin, salty (Under-extracted)
- Increase Infusion Pressure/Flow: 8→9 bar, or 2→2.5 ml/s
- Extend Infusion Time: Increase yield before tapering begins
- Increase Temperature: 92°C→94°C

### Bitter, astringent, dry (Over-extracted)
- Lower Infusion Pressure: 9→8 bar
- Taper Earlier/Aggressively: Start ramp-down sooner
- Lower Temperature: 94°C→92°C

### Shot starts too fast (gushing)
- Grind Finer (primary fix)
- Decrease Pre-infusion Flow: 4→2 ml/s

### Shot chokes (starts too slow)
- Grind Coarser
- Add bloom phase to help water penetrate
- Increase initial infusion pressure to push through resistance

## 5. Profile Design Best Practices

### Control Strategy: Flow vs Pressure
- **Flow-Controlled**: Adapts to puck resistance, forgiving of grind variance. Better for consistency
- **Pressure-Controlled**: Traditional approach, needs precise grind. Better for body/texture targeting
- **Hybrid** (recommended): Pressure control with flow limits, or flow control with pressure limits

### Stage Transition Design
- Pre-infusion exit: Use pressure threshold (<=2 bar) OR weight threshold (>=0.3g). Multiple triggers ensure stage exits on saturation.
- Infusion exit: Always use weight threshold with >= comparison + time safety timeout.
- Tapering exit: Use final target weight + time limit.

### Dynamics Point Design
- Start point: [0, initial_value], End point: [duration, final_value]
- "linear": Predictable, good for most cases
- "curve": Smoother transitions, good for lever-style profiles
- Gentle pressure ramps (3-4s) prevent channeling; aggressive (<2s) risk it

### Exit Trigger Best Practices
- Use >= for weight/flow thresholds (responsive)
- Use <= for pressure thresholds when pressure should drop
- Multiple triggers = safety (primary goal + time backup)
- Time triggers: ALWAYS "relative": true
- Dynamics points x-axis: always relative to stage start (0 = beginning)

### Temperature Considerations
- Light roasts: Higher temp (92-96°C) needed for proper extraction
- Medium roasts: Balanced temp (90-93°C)
- Dark roasts: Lower temp (82-90°C) prevents over-extraction bitterness

### Yield Target Design
- Classic espresso: 30-36g yield, Ristretto: 20-25g, Lungo: 40-50g
- Sprover: 40-60g, Soup/Allongé: 60-100g+
- Pre-infusion: 5-10% of yield, Infusion: 60-75%, Tapering: 20-30%

### Common Anti-Patterns to Avoid
❌ Single Exit Trigger: Only weight OR only time = risky. Include multiple triggers.
❌ Exact Match Triggers: Waiting for exact weight (30.0g) = unreliable. Use >= comparison.
❌ Too Many Stages: >5-6 stages = overcomplicated. 3-4 is usually optimal.
❌ No Safety Timeouts: Missing time triggers = risk of infinite extraction.
❌ Pressure Spikes: Sudden jumps = channeling risk. Use gentle ramps (3+ seconds).

## 6. Equipment Factors
- **Grind setting**: Primary extraction control. Fine = slower, more extraction
- **Basket type**: VST/IMS precision baskets vs stock baskets affect flow distribution
- **Bottom filter**: Paper filters reduce sediment but also oils (cleaner but thinner)
- **Puck prep**: WDT, leveling, and tamp consistency affect channeling risk

`

const VALIDATION_RETRY_PROMPT = `The profile JSON you generated has validation errors. Fix ALL of the following errors and return ONLY the corrected JSON in a fenced \`\`\`json block. Do not include any other text.

ERRORS:
{errors}

ORIGINAL JSON:
\`\`\`json
{json}
\`\`\``

const SHOT_ANALYSIS_PROMPT = `You are an expert espresso analyst evaluating shot data from a Meticulous espresso machine.

Analyze the extraction data provided and give actionable feedback. Consider:
1. **Extraction Quality**: Based on time, weight, and ratio
2. **Pressure Profile**: Is the pressure curve healthy? Look for channeling signs
3. **Flow Analysis**: Flow rate consistency, any stalls or gushes
4. **Temperature Stability**: How stable was the brew temperature

Respond in markdown with these sections:
**Overall Rating**: X/10 with brief summary
**What Went Well**: 1-3 positive observations
**Areas for Improvement**: 1-3 specific, actionable suggestions
**Dial-In Recommendation**: One concrete change to try next (grind, dose, temp, or profile adjustment)

Keep the analysis concise and practical — focus on what the user can actually change.
`

// ── Gemini REST API ──────────────────────────────────────────────────────

interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

async function callGemini(
  apiKey: string,
  parts: GeminiPart[],
  originalFetch: typeof fetch,
): Promise<string> {
  const resp = await originalFetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 8192 },
      }),
    },
  )

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    if (resp.status === 429) throw new Error('Rate limit exceeded. Please wait a minute and try again.')
    if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Gemini API key. Check your key in Settings.')
    throw new Error(`Gemini API error ${resp.status}: ${errBody.slice(0, 200)}`)
  }

  const data = await resp.json()
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

function extractProfileJson(reply: string): Record<string, unknown> | null {
  const match = reply.match(/```json\s*([\s\S]*?)```/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { data: btoa(binary), mimeType: file.type || 'image/jpeg' }
}

// ── Public API ───────────────────────────────────────────────────────────

/** Build the full profile generation prompt from modular sections (matches server). */
function buildGeneratePrompt(authorName: string, userTask: string): string {
  const authorSection = `AUTHOR:\n• Set the 'author' field in the profile JSON to: "${authorName}"\n\n`

  return (
    BARISTA_PERSONA +
    PROFILE_GUIDELINES +
    VALIDATION_RULES +
    ERROR_RECOVERY +
    NAMING_CONVENTION +
    authorSection +
    SDK_OUTPUT_INSTRUCTIONS +
    OUTPUT_FORMAT +
    PROFILING_KNOWLEDGE +
    OEPF_REFERENCE +
    userTask
  )
}

export async function generateProfile(
  formData: FormData,
  originalFetch: typeof fetch,
): Promise<{ status: string; analysis: string | null; reply: string; generation_id: string; history_id?: string }> {
  const apiKey = localStorage.getItem('meticai-gemini-key')?.trim()
  if (!apiKey) {
    return { status: 'error', analysis: null, reply: 'Gemini API key is not configured. Go to Settings to add your key.', generation_id: '' }
  }

  // Parse inputs
  const preferences = (formData.get('preferences') as string) || ''
  let tags: string[] = []
  const tagsStr = formData.get('tags') as string
  if (tagsStr) {
    try { tags = JSON.parse(tagsStr) } catch { /* ignore */ }
  }
  const imageFile = formData.get('image') as File | null

  const allPrefs = [preferences, ...tags].filter(Boolean).join(', ')
  if (!allPrefs && !imageFile) {
    return { status: 'error', analysis: null, reply: 'Please provide taste preferences or a coffee bag photo.', generation_id: '' }
  }

  // Build task section
  const authorName = localStorage.getItem('meticai-author-name') || 'MeticAI'
  let userTask: string
  if (imageFile && allPrefs) {
    userTask = (
      `CONTEXT: You control a Meticulous Espresso Machine via local API.\n` +
      `Analyze the coffee bag image.\n\n` +
      `⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n` +
      `'${allPrefs}'\n` +
      `You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n` +
      `TASK: Create a sophisticated espresso profile based on the coffee analysis while strictly adhering to the user's requirements above.\n`
    )
  } else if (imageFile) {
    userTask = (
      `CONTEXT: You control a Meticulous Espresso Machine via local API.\n` +
      `Analyze the coffee bag image.\n\n` +
      `TASK: Create a sophisticated espresso profile for this coffee.\n`
    )
  } else {
    userTask = (
      `CONTEXT: You control a Meticulous Espresso Machine via local API.\n\n` +
      `⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n` +
      `'${allPrefs}'\n` +
      `You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n` +
      `TASK: Create a sophisticated espresso profile while strictly adhering to the user's requirements above.\n`
    )
  }

  const fullPrompt = buildGeneratePrompt(authorName, userTask)

  // Build Gemini parts
  const parts: GeminiPart[] = [{ text: fullPrompt }]
  if (imageFile) {
    const img = await fileToBase64(imageFile)
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
  }

  // Call Gemini
  let reply = await callGemini(apiKey, parts, originalFetch)

  // ── Validation + retry loop (matches server behavior) ────────────────
  let profileJson = extractProfileJson(reply)
  let attempt = 0

  while (attempt <= MAX_VALIDATION_RETRIES) {
    if (!profileJson) {
      // No JSON extracted — ask model to regenerate
      if (attempt < MAX_VALIDATION_RETRIES) {
        attempt++
        const retryReply = await callGemini(
          apiKey,
          [{
            text: 'Your previous response did not contain a valid JSON profile block. ' +
              'Please generate the complete profile JSON in a fenced ```json block. ' +
              'Include the full profile object with name, stages, variables, and temperature.',
          }],
          originalFetch,
        )
        profileJson = extractProfileJson(retryReply)
        if (profileJson) {
          reply += '\n\nPROFILE JSON:\n```json\n' + JSON.stringify(profileJson, null, 2) + '\n```'
        }
        continue
      }
      break
    }

    // We have JSON — validate it programmatically
    const result = validateProfile(profileJson)
    if (result.isValid) break

    // Validation failed — try to fix
    if (attempt < MAX_VALIDATION_RETRIES) {
      attempt++
      const errorSummary = result.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
      const fixPrompt = VALIDATION_RETRY_PROMPT
        .replace('{errors}', errorSummary)
        .replace('{json}', JSON.stringify(profileJson, null, 2))

      const fixReply = await callGemini(apiKey, [{ text: fixPrompt }], originalFetch)
      const fixedJson = extractProfileJson(fixReply)
      if (fixedJson) {
        profileJson = fixedJson
        // Replace the JSON block in the reply with the corrected version
        reply = reply.replace(
          /```json\s*[\s\S]*?```/,
          '```json\n' + JSON.stringify(fixedJson, null, 2) + '\n```',
        )
      }
      continue
    }
    // Exhausted retries — proceed with best-effort profile
    break
  }

  if (!profileJson) {
    return {
      status: 'error',
      analysis: null,
      reply: reply || 'The AI failed to generate a valid profile JSON. Please try again.',
      generation_id: Date.now().toString(36),
    }
  }

  // Save profile to machine
  try {
    await originalFetch('/api/v1/profile/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileJson),
    })
  } catch {
    // Profile save failed — still return the result so user sees the profile
  }

  return {
    status: 'success',
    analysis: null,
    reply,
    generation_id: Date.now().toString(36),
  }
}

export async function analyzeShotWithAI(
  shotData: { profile_name?: string; elapsed_time?: number; final_weight?: number; dose?: number; data?: { time?: number[]; pressure?: number[]; flow?: number[]; weight?: number[]; temperature?: number[] } },
  originalFetch: typeof fetch,
): Promise<{ status: string; analysis: string }> {
  const apiKey = localStorage.getItem('meticai-gemini-key')?.trim()
  if (!apiKey) {
    return { status: 'error', analysis: 'Gemini API key is not configured. Go to Settings to add your key.' }
  }

  const dose = shotData.dose ?? 18
  const finalWeight = shotData.final_weight ?? 0
  const ratio = finalWeight > 0 && dose > 0 ? (finalWeight / dose).toFixed(1) : 'unknown'
  const elapsed = shotData.elapsed_time ?? 0

  // Build a compact data summary for the LLM
  const dataSummary = shotData.data ? [
    `Time points: ${shotData.data.time?.length ?? 0}`,
    `Max pressure: ${Math.max(...(shotData.data.pressure ?? [0])).toFixed(1)} bar`,
    `Max flow: ${Math.max(...(shotData.data.flow ?? [0])).toFixed(1)} ml/s`,
    `Final weight: ${finalWeight.toFixed(1)}g`,
    `Avg temperature: ${shotData.data.temperature?.length ? (shotData.data.temperature.reduce((a, b) => a + b, 0) / shotData.data.temperature.length).toFixed(1) : 'N/A'}°C`,
  ].join(', ') : 'No detailed data available'

  const userPrompt = `${SHOT_ANALYSIS_PROMPT}

Shot data:
- Profile: ${shotData.profile_name ?? 'Unknown'}
- Dose: ${dose}g → Yield: ${finalWeight.toFixed(1)}g (ratio 1:${ratio})
- Total time: ${elapsed.toFixed(1)}s
- ${dataSummary}
`

  const reply = await callGemini(apiKey, [{ text: userPrompt }], originalFetch)
  return { status: 'success', analysis: reply }
}
