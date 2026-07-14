"""Gemini service for AI model configuration and prompt building."""

from google import genai
import asyncio
import hashlib
import os
import re
from typing import Optional
from services.settings_service import get_author_name
from logging_config import get_logger

logger = get_logger()


class ModelUnavailableError(RuntimeError):
    """Raised when no compatible Gemini model can be found."""


# Lazy-loaded Gemini client
_gemini_client: Optional[genai.Client] = None
_DEFAULT_MODEL = "gemini-2.5-flash"


def get_model_name() -> str:
    """Return the configured model name for the active provider, resolved now.

    For Gemini, reads ``GEMINI_MODEL`` from the environment on every call so
    that hot-reloaded service restarts pick up changes (blank values fall back
    to the default). For non-Gemini providers, delegates to the provider
    registry (``AI_MODEL`` / provider default).
    """
    from services.ai_providers import get_provider_model, is_gemini_active

    if not is_gemini_active():
        return get_provider_model()
    value = os.environ.get("GEMINI_MODEL", "").strip()
    return value or _DEFAULT_MODEL


async def validate_model(model_name: str) -> bool:
    """Check if a model is available via the Gemini API."""
    try:
        client = get_gemini_client()
    except ValueError:
        return False
    try:
        await asyncio.to_thread(client.models.get, model=model_name)
        return True
    except Exception as e:
        logger.warning("Model %s unavailable: %s", model_name, e)
        return False


async def get_available_models() -> list[dict]:
    """Return list of available models suitable for text generation.

    For non-Gemini providers, delegates to the OpenAI-compatible provider's
    ``/models`` endpoint; for Gemini, queries the Gemini SDK and filters to
    text-capable models.
    """
    from services.ai_providers import is_gemini_active, list_provider_models

    if not is_gemini_active():
        return await list_provider_models()

    try:
        client = get_gemini_client()
    except ValueError:
        return []
    try:
        models = await asyncio.to_thread(lambda: list(client.models.list()))
        result = []
        for m in models:
            if hasattr(m, "supported_actions") and "generateContent" in (
                m.supported_actions or []
            ):
                if not _is_text_model(_model_short_name(m.name or "")):
                    continue
                result.append(
                    {
                        "id": m.name,
                        "display_name": m.display_name or m.name,
                        "description": m.description or "",
                    }
                )
        return result
    except Exception as e:
        logger.error("Failed to list models: %s", e)
        return []


# Name fragments that identify non-text model families to skip.
_NON_TEXT_FRAGMENTS = (
    "embedding",
    "aqa",
    "imagen",
    "image",
    "tts",
    "computer-use",
    "robotics",
)
# Patterns that mark a model as preview/experimental/dated-snapshot (unstable).
_UNSTABLE_RE = re.compile(r"(preview|experimental|-exp\b|exp$|-\d{2}-\d{2}|-\d{3,4}$)")


def _model_short_name(name: str) -> str:
    """Strip a leading 'models/' prefix and lowercase."""
    return name.split("/")[-1].strip().lower()


def _is_text_model(short: str) -> bool:
    """True only for Gemini text-chat models.

    Requires the ``gemini-`` prefix (excludes non-Gemini families such as
    gemma, lyria, nano-banana, deep-research and antigravity) and rejects
    special-purpose Gemini variants (image, tts, computer-use, robotics, …)
    via ``_NON_TEXT_FRAGMENTS``.
    """
    if not short.startswith("gemini-"):
        return False
    return not any(f in short for f in _NON_TEXT_FRAGMENTS)


def rank_models(models: list[dict]) -> Optional[str]:
    """Pick the best generateContent-capable model from a discovered list.

    Heuristic: prefer stable over preview/experimental; within a tier prefer
    flash > flash-lite > pro > other; within a class prefer the highest
    gemini-<major>.<minor> version. Returns the model id (without the
    'models/' prefix) or None if nothing compatible remains.

    The ``-\\d{3,4}$`` / dated-snapshot patterns in ``_UNSTABLE_RE`` intentionally
    treat pinned version snapshots (e.g. ``gemini-2.0-flash-001``) as lower-priority
    than the floating stable alias (e.g. ``gemini-2.5-flash``); this is by design so
    the resolver prefers the auto-updating stable alias over a frozen snapshot.

    Model *class* (flash > flash-lite > pro > other) takes precedence over version
    number — a lower-tier model of any generation beats a higher-tier model, because
    cost and latency outweigh marginal quality for this summarization use case.
    """
    candidates = []
    for m in models:
        raw = m.get("id") or ""
        short = _model_short_name(raw)
        if not _is_text_model(short):
            continue
        candidates.append(short)
    if not candidates:
        return None

    def score(short: str):
        unstable = 1 if _UNSTABLE_RE.search(short) else 0
        if "flash-lite" in short:
            cls = 1
        elif "flash" in short:
            cls = 0
        elif "pro" in short:
            cls = 2
        else:
            cls = 3
        vm = re.search(r"gemini-(\d+)\.(\d+)", short)
        major, minor = (int(vm.group(1)), int(vm.group(2))) if vm else (0, 0)
        # Lower tuple sorts first: stable, then class, then highest version, then name.
        return (unstable, cls, -major, -minor, short)

    return min(candidates, key=score)


async def get_working_model() -> str:
    """Return a working model id, validating the configured model first and
    falling back to dynamic discovery via the live models list.

    Raises ModelUnavailableError when no compatible model can be found.
    """
    configured = get_model_name()
    if await validate_model(configured):
        _validated_model_cache["model"] = configured
        return configured

    logger.warning("Configured model '%s' unavailable, discovering alternatives…", configured)
    best = rank_models(await get_available_models())
    if best:
        logger.info("Selected fallback model via discovery: %s", best)
        _validated_model_cache["model"] = best
        return best

    logger.error("No compatible Gemini model found via discovery!")
    raise ModelUnavailableError("No compatible Gemini model is available for this API key.")


# Cache for the last validated working model
_validated_model_cache: dict[str, str] = {}


def get_working_model_sync() -> str:
    """Return cached working model or fall back to get_model_name().

    Avoids async validation in sync contexts.  The cache is populated
    by ``get_working_model()`` (called at startup and via the /available-models
    endpoint) so the first generation request always uses a validated model.
    """
    return _validated_model_cache.get("model", get_model_name())


def get_working_model_force() -> str:
    """Synchronously re-resolve a working model, bypassing the cache.

    Runs the async resolver in a fresh event loop (safe because the SDK call
    is already off the asyncio loop in a thread executor).
    """
    _validated_model_cache.pop("model", None)
    return asyncio.run(get_working_model())


# Noise prefixes to filter from error messages (used by parse_gemini_error)
_GEMINI_NOISE_PREFIXES = (
    "YOLO mode is enabled",
    "Hook registry initialized",
    "Error executing tool ",
)

# Shared espresso profiling knowledge for LLM context.
# Used by shot analysis, profile description generation, and description conversion.
# This is the full Advanced Espresso Profiling Guide, also served by the
# get_profiling_knowledge MCP tool (topic="guide").
PROFILING_KNOWLEDGE = """# Advanced Espresso Profiling Guide for the Meticulous Machine

This reference is designed for creating and executing precise espresso profiles using the Meticulous Home Espresso machine, a digitally controlled robotic lever system that offers unparalleled control over flow, pressure, and temperature.

## 1. Core Concepts: A Deeper Dive

To build precise profiles, a granular understanding of the key variables and their interplay is essential. The Meticulous machine controls these variables directly, rather than through manual approximation.

### Variable Control

**Flow Rate (ml/s)** - The Primary Driver of Extraction
- Controls the speed of water delivery to the puck
- Higher flow rate increases extraction speed and highlights acidity and clarity
- Lower flow rate allows longer contact time, building body and sweetness
- Meticulous Control: Digital motor controls lever descent, allowing direct flow rate programming

**Pressure (bar)** - The Result of Flow vs. Resistance
- Pressure builds as water flow meets puck resistance
- Crucial for creating texture, mouthfeel, and crema
- High pressure increases body but risks channeling if not managed
- Meticulous Control: Can target specific pressure with sensors measuring force and motor adjusting lever

**Temperature (°C)** - The Catalyst for Solubility
- Dictates which flavor compounds dissolve from coffee grounds
- Lighter roasts: Higher temperatures (92-96°C) needed for sweetness
- Darker roasts: Lower temperatures (82-90°C) reduce bitterness
- Meticulous Control: High-precision PID temperature control for boiler and heated grouphead

### Understanding Puck Dynamics

The coffee puck evolves throughout extraction:

1. **Initial Saturation**: Dry grounds swell and release CO2. Uneven wetting causes channeling.
2. **Peak Resistance**: Early in shot, puck offers maximum resistance.
3. **Puck Erosion**: As compounds dissolve, puck integrity weakens, resistance decreases.
4. **Fines Migration**: Microscopic particles can clog filter, temporarily increasing resistance.

A flat, static profile fails to account for this evolution. Dynamic profiles adapt to the puck's changing state.

## 2. A Phased Approach to Profile Building

Break down every shot into four distinct, controllable phases:

### Phase 1: Pre-infusion
- **Goal**: Gently and evenly saturate entire puck to prevent channeling
- **Control**: Flow Rate
- **Target Flow**: 2-4 ml/s
- **Target Pressure Limit**: ~2 bar
- **Duration**: Until first drops appear, or specific volume (5-8 ml) delivered
- **Exit (#420, native triggers)**: end on a native weight trigger at ≈ 2 × dose
  (water/dose correlation) AND a native pressure trigger (~2 bar, pressure rise),
  with a time safety backup — whichever fires first

### Phase 2: Bloom (Dwell) - Optional
- **Goal**: Allow saturated puck to rest, releasing CO2, enabling deeper penetration
- **Control**: Time (zero flow)
- **Holding Pressure**: 0.5-1.5 bar (prevents puck unseating)
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
- **Action**: Gradually decrease pressure (e.g., 9 bar to 4 bar) or reduce flow (e.g., 2 ml/s to 1 ml/s)
- **Duration**: Final 1/3 of shot's volume

## 3. Espresso Profile Blueprints

### Blueprint 1: The "Classic Lever"
**Best for**: Medium to Medium-Dark Roasts
**Goal**: Balanced, full-bodied shot with rich crema and chocolate/caramel notes

**Profile Steps**:
1. Pre-infusion: Flow @ 3 ml/s, end when pressure reaches 2.0 bar OR weight reaches 2× dose (time backup)
2. Infusion: Pressure @ 9.0 bar, end when 25g yielded
3. Tapering: Linearly decrease pressure 9.0 bar to 5.0 bar, end when 36g total

### Blueprint 2: The "Turbo Shot"
**Best for**: Light Roasts, Single Origins
**Goal**: Bright, clear, acidic shot highlighting floral and fruit notes

**Profile Steps**:
1. Pre-infusion: Flow @ 6 ml/s, end when pressure reaches 1.5 bar OR weight reaches 2× dose (time backup)
2. Infusion: Pressure @ 6.0 bar, end after 15 seconds total
3. Tapering: Linearly decrease pressure 6.0 bar to 3.0 bar, end when 54g total (1:3 ratio)

### Blueprint 3: The "Soup" Shot (Allongé)
**Best for**: Very Light / Experimental Roasts (high-acidity Geshas)
**Goal**: Tea-like, highly clarified extraction with no bitterness

**Profile Steps**:
1. Pre-wet: Flow @ 4 ml/s, end when 10g yielded
2. Infusion: Flow @ 8 ml/s, end when 72g total (1:4 ratio)
Note: No pressure target, entirely flow-controlled

### Blueprint 4: The "Bloom & Extract"
**Best for**: Very Freshly Roasted Coffee (<7 days from roast)
**Goal**: Manage excess CO2 for even extraction and sweetness

**Profile Steps**:
1. Pre-infusion: Flow @ 3 ml/s, end when pressure reaches 2.0 bar OR weight reaches 2× dose (time backup)
2. Bloom: Hold lever position (zero flow) for 20 seconds
3. Infusion: Pressure @ 8.0 bar, end when 30g yielded
4. Tapering: Linearly decrease pressure 8.0 bar to 4.0 bar, end when 38g total

## 4. Advanced Troubleshooting & Adaptation

### Sour, thin, salty (Under-extracted)
**Likely Cause**: Insufficient contact time or energy
**Solutions**:
1. Increase Infusion Pressure/Flow: 8 bar -> 9 bar, or 2 ml/s -> 2.5 ml/s
2. Extend Infusion Time: Increase yield before tapering begins
3. Increase Temperature: 92°C -> 94°C

### Bitter, astringent, dry (Over-extracted)
**Likely Cause**: Puck channeled or too much extraction at end
**Solutions**:
1. Lower Infusion Pressure: 9 bar -> 8 bar
2. Taper Earlier/Aggressively: Start ramp-down sooner or decrease to lower final pressure
3. Lower Temperature: 94°C -> 92°C

### Shot starts too fast (gushing)
**Likely Cause**: Grind too coarse, or pre-infusion too aggressive
**Solutions**:
1. Grind Finer (primary fix)
2. Decrease Pre-infusion Flow: 4 ml/s -> 2 ml/s

### Shot chokes (starts too slow)
**Likely Cause**: Grind too fine
**Solutions**:
1. Grind Coarser
2. Add bloom phase to help water penetrate
3. Increase initial infusion pressure to push through resistance

## 5. Profile Design Principles & Best Practices

### Control Strategy: Flow vs Pressure

**Flow-Controlled Profiles**:
- More adaptive to puck resistance - automatically adjusts to grind variations
- Better for consistent results across different coffees
- Flow rate determines extraction speed directly
- Use when: Working with variable beans, different grinders, or seeking adaptability

**Pressure-Controlled Profiles**:
- More predictable pressure curves, traditional espresso approach
- Requires precise grind matching for optimal results
- Better for: Specific flavor profile targeting, traditional lever machine emulation
- Use when: You have dialed-in grind and want precise control over texture/body

**Hybrid Approach**:
- Use pressure control with flow limits (safety bounds)
- Use flow control with pressure limits (prevent channeling)
- Best of both worlds: responsive with safety guards

### Stage Transition Design

**Pre-infusion Exit Strategy**:
- Use pressure threshold (<= 2 bar) OR flow threshold (>= 0.2 ml/s) OR weight threshold (>= 0.3g)
- Multiple triggers ensure stage exits when saturation achieved, not on exact timing

**Pre-infusion Saturation Rules (#420) — express with NATIVE machine triggers**:
The machine only honors native exit trigger types ("weight", "pressure", "flow",
"time"). Implement the following intent using those native types so the machine
actually acts on them — do NOT emit app-only pseudo triggers.
- **Dose/water correlation → native WEIGHT trigger**: A puck needs roughly twice
  its dose in water to fully saturate (e.g., an 18 g dose absorbs ~36 ml). Add a
  weight exit trigger with value ≈ 2 × dose (comparison ">="), computing it from
  the actual dose in the request. This ends pre-infusion once enough water has
  been delivered, regardless of grind.
- **Pressure rise → native PRESSURE trigger**: As the puck saturates, resistance
  builds and pressure climbs. Add a pressure exit trigger at a low threshold
  (~2 bar, ">=") so the stage ends the moment pressure starts to rise.
- Always pair both with a TIME safety backup; whichever native trigger fires
  first ends pre-infusion.

**Infusion/Hold Exit Strategy**:
- Always use weight threshold with >= comparison for target yield
- Always include time-based safety timeout (prevents infinite extraction)
- Weight should be primary trigger, time is backup

**Tapering Exit Strategy**:
- Use final target weight with >= comparison
- Include time limit to prevent over-extraction

### Dynamics Point Design

**Minimum Points Required**:
- Start point: [0, initial_value]
- End point: [duration, final_value]

**Interpolation Strategy**:
- "linear": Predictable, easy to understand, good for most cases
- "curve": Smoother transitions, can feel more natural, good for lever-style profiles
- "none": Instant transitions (rarely needed)

**Pressure Ramp Design**:
- Gentle ramps (3-4 seconds) prevent channeling
- Aggressive ramps (<2 seconds) can cause channeling but faster extraction

**Pressure Decline Design**:
- Gradual decline (over 10-15 seconds) = smoother finish
- Steep decline (over 3-5 seconds) = faster finish, may extract more fines

### Exit Trigger Best Practices

**Always Use Comparison Operators**:
- Use >= for weight thresholds (responsive, exits when reached)
- Use >= for flow thresholds (responsive, exits when achieved)
- Use <= for pressure thresholds when pressure should drop
- Never rely on exact matches - they're unreliable and slow

**Multiple Triggers = Safety & Responsiveness**:
- Primary trigger: The main goal (weight, flow, etc.)
- Secondary trigger: Safety timeout (time-based)
- Logical OR ensures the stage exits on the FIRST condition met

**Relative vs Absolute Values**:
- Time exit triggers: ALWAYS use "relative": true (time relative to stage start). Never use absolute time.
- Relative weight: Value relative to stage start (useful for multi-stage recipes)
- Absolute weight: Total weight from shot start (easier to understand)
- Use absolute weight for clarity, relative weight only when needed for complex recipes
- dynamics_points x-axis values are always relative to stage start (0 = beginning of stage)

### Temperature Considerations

**Roast Level Matching**:
- Light roasts: Higher temp (92-96°C) needed for proper extraction
- Medium roasts: Balanced temp (90-93°C)
- Dark roasts: Lower temp (82-90°C) prevents over-extraction bitterness

### Yield Target Design

**Espresso Range** (25-40g):
- Classic espresso: 30-36g yield
- Ristretto: 20-25g yield
- Lungo: 40-50g yield

**Extended Range** (40-100g):
- Sprover: 40-60g (hybrid espresso/pour-over)
- Soup/Allongé: 60-100g+ (tea-like extraction)

**Yield Distribution Across Stages**:
- Pre-infusion: 5-10% of total yield
- Infusion: 60-75% of total yield
- Tapering: Remaining 20-30%

### Common Anti-Patterns to Avoid

**❌ Single Exit Trigger**: Only weight OR only time = risky. Include multiple triggers for safety.
**❌ Exact Match Triggers**: Waiting for exact weight (e.g., 30.0g) = unreliable. Use >= comparison.
**❌ Too Many Stages**: More than 5-6 stages = overcomplicated. 3-4 stages is usually optimal.
**❌ No Safety Timeouts**: Missing time-based triggers = risk of infinite extraction.
**❌ Pressure Spikes**: Sudden pressure jumps = channeling risk. Use gentle ramps (3+ seconds).
**❌ Recommending Weight Exit Triggers**: All Meticulous profiles automatically have a weight-based exit trigger at the overall profile level. NEVER recommend adding a weight exit trigger for the overall profile or for the final stage — it is always already present and handled by the machine firmware. Only recommend weight triggers for intermediate stages when needed.

## 6. Equipment Factors

- **Grind setting**: Primary extraction control. Fine = slower, more extraction
- **Basket type**: VST/IMS precision baskets vs stock baskets affect flow distribution
- **Bottom filter**: Paper filters reduce sediment but also oils (cleaner but thinner)
- **Puck prep**: WDT, leveling, and tamp consistency affect channeling risk
- **Grinder characteristics**: Particle distribution varies by grinder model, may need profile adjustments
"""


# Distilled version of the profiling knowledge for token-optimized prompts.
# Focuses on decision heuristics and practical rules rather than theory.
# ~2.5K chars vs ~10.8K chars for the full version.
PROFILING_KNOWLEDGE_DISTILLED = """\
# Espresso Profiling Quick Reference

## Roast → Profile Matching
- Light roast: higher temp (92-96°C), lower pressure (6-7 bar), higher ratio (1:2.5-1:3+), flow-controlled, turbo-style
- Medium roast: balanced temp (90-93°C), classic 9 bar pressure, standard ratio (1:2-1:2.5)
- Dark roast: lower temp (82-90°C), gentler pressure (7-8 bar), shorter ratio (1:1.5-1:2), avoid over-extraction
- Very fresh (<7 days): add bloom/dwell phase (5-30s at zero flow) to release CO2

## Four-Phase Structure
1. **Pre-infusion**: Flow 2-4 ml/s, pressure limit ~2 bar, exit on pressure threshold or weight ~5-8g
   Saturation rules (#420), as NATIVE triggers: native weight exit at ≈ 2 × dose (water/dose correlation) AND native pressure exit (~2 bar, pressure rise), plus a time backup
2. **Bloom** (optional): Zero flow, hold 0.5-1.5 bar, 5-30s. Use for fresh coffee or light roasts
3. **Infusion**: Ramp to target pressure/flow. This is where 60-75% of yield extracts
4. **Taper**: Decline pressure/flow over final 20-30% of yield. Reduces bitterness and astringency

## Profile Blueprints (compressed)
- **Classic Lever** (medium-dark): Pre-infuse→9 bar hold→taper 9→5 bar. Ratio 1:2
- **Turbo** (light/single origin): Pre-infuse→6 bar→taper 6→3 bar. Ratio 1:3. Fast, bright, clear
- **Allongé/Soup** (very light): Pre-wet→high flow (8 ml/s). Ratio 1:4. Tea-like, no pressure target
- **Bloom & Extract** (very fresh): Pre-infuse→20s bloom→8 bar→taper 8→4 bar

## Troubleshooting
- Sour/thin → increase pressure, extend extraction, raise temp
- Bitter/astringent → lower pressure, taper earlier, lower temp
- Gushing → grind finer, reduce pre-infusion flow
- Choking → grind coarser, add bloom phase, increase initial pressure

## Control Strategy
- **Flow-controlled**: Adapts to puck resistance, forgiving of grind variance. Better for consistency
- **Pressure-controlled**: Traditional approach, needs precise grind. Better for body/texture targeting
- **Hybrid** (recommended): Pressure control with flow limits, or flow control with pressure limits

## Key Design Rules
- Dynamics points x-axis is ALWAYS relative to stage start (0 = stage start)
- Gentle pressure ramps (3-4s) prevent channeling; aggressive (<2s) risk it
- Keep profiles to 3-4 stages (5-6 max). Simpler = more reliable
- Pre-infusion: ~5-10% of yield. Infusion: 60-75%. Taper: remaining 20-30%
- NEVER recommend adding a weight exit trigger for the overall profile or the final stage — all Meticulous profiles already have an automatic weight-based exit trigger handled by firmware
"""


def parse_gemini_error(error_text: str) -> str:
    """Parse Gemini SDK/API error output and return a user-friendly message.

    Extracts the meaningful error message from verbose error details
    for display to end users.

    Args:
        error_text: Raw stderr output from the Gemini CLI

    Returns:
        A clean, user-friendly error message
    """
    error_text_lower = error_text.lower()

    # Check for deprecated / unavailable model errors (404 NOT_FOUND)
    if (
        "no longer available" in error_text_lower
        or ("not_found" in error_text_lower and "model" in error_text_lower)
        or ("404" in error_text_lower and "model" in error_text_lower)
        or "deprecated" in error_text_lower
    ):
        return (
            "The AI model is no longer available. Please update MeticAI to the "
            "latest version, or set a custom GEMINI_MODEL in your environment."
        )

    # Check for quota errors
    if "quota" in error_text_lower or "exhausted" in error_text_lower:
        return (
            "Daily API quota exhausted. The free Gemini API has usage limits. "
            "Please wait until tomorrow for your quota to reset, or upgrade to "
            "a paid API plan at https://aistudio.google.com/"
        )

    # Check for rate limiting
    if "rate limit" in error_text_lower or "too many requests" in error_text_lower:
        return (
            "Rate limit exceeded. Too many requests in a short time. "
            "Please wait a minute and try again."
        )

    # Check for authentication errors
    if (
        "api key" in error_text_lower
        or "api_key" in error_text_lower
        or "authentication" in error_text_lower
        or "unauthorized" in error_text_lower
        or "auth method" in error_text_lower
        or "set an auth" in error_text_lower
    ):
        return (
            "Gemini API key is not configured. Please go to Settings and "
            "enter a valid GEMINI_API_KEY, then try again."
        )

    # Check for long-running generation / model stall patterns
    # (must come before the general network/connection check which also
    # matches 'timeout' — we want the more specific message here.)
    if (
        "timed out after" in error_text_lower
        or "deadline exceeded" in error_text_lower
        or "took too long" in error_text_lower
    ):
        return (
            "Profile generation timed out. Please retry; if this repeats, "
            "reduce prompt complexity or use a stronger Gemini model."
        )

    # Check for network/connection errors
    if (
        "network" in error_text_lower
        or "connection" in error_text_lower
        or "timeout" in error_text_lower
    ):
        return (
            "Network error connecting to Gemini API. Please check your "
            "internet connection and try again."
        )

    # Check for schema/validation failures produced during profile creation
    if (
        "validation" in error_text_lower
        or "schema" in error_text_lower
        or "invalid profile" in error_text_lower
        or "failed to validate" in error_text_lower
    ):
        return (
            "The AI generated a profile that failed schema validation. "
            "Please retry; if this keeps happening, simplify preferences "
            "or try a stronger model."
        )

    # Check for MCP/Meticulous connection errors
    if "mcp" in error_text_lower or "meticulous" in error_text_lower:
        if (
            "connection refused" in error_text_lower
            or "cannot connect" in error_text_lower
        ):
            return (
                "Cannot connect to the Meticulous machine. Please ensure your "
                "espresso machine is powered on and connected to the network."
            )

    # Check for content safety errors
    if "safety" in error_text_lower or "blocked" in error_text_lower:
        return (
            "Request was blocked by content safety filters. "
            "Please try rephrasing your preferences."
        )

    # Try to extract a clean error message from stack trace
    # Look for common error patterns
    patterns = [
        r"Error:\s*(.+?)(?:\n|$)",
        r"error:\s*(.+?)(?:\n|$)",
        r"Exception:\s*(.+?)(?:\n|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, error_text, re.IGNORECASE)
        if match:
            extracted = match.group(1).strip()
            # Don't return if it's just a file path or technical detail
            if (
                len(extracted) > 10
                and not extracted.startswith("/")
                and not extracted.startswith("file:")
            ):
                return extracted[:200]  # Limit length

    # Fallback: strip noise lines before returning
    clean_error = error_text
    for prefix in _GEMINI_NOISE_PREFIXES:
        clean_error = "\n".join(
            line
            for line in clean_error.split("\n")
            if not line.strip().startswith(prefix)
        )
    clean_error = clean_error.strip()

    if not clean_error:
        return "Profile generation failed unexpectedly. Please try again."
    if len(clean_error) > 150:
        return f"Profile generation failed. Technical details: {clean_error[:100]}..."

    return f"Profile generation failed: {clean_error}"


def reset_vision_model():
    """Reset the cached Gemini client.

    Call this when the GEMINI_API_KEY changes so the next call to
    get_gemini_client() will re-create with the new key.
    """
    global _gemini_client
    _gemini_client = None


def get_gemini_client() -> genai.Client:
    """Lazily initialize and return the Gemini client."""
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY environment variable is required but not set. "
                "Please set it before starting the server."
            )
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def is_ai_available() -> bool:
    """Return True when an API key is configured for the active provider."""
    from services.ai_providers import is_provider_available

    return is_provider_available()


def get_vision_model():
    """Return a wrapper that provides the old model.generate_content() interface.

    Routes to the OpenAI-compatible provider when a non-Gemini provider is
    active, otherwise returns the Gemini SDK wrapper. Both expose the same
    ``generate_content`` / ``async_generate_content`` interface:
        model = get_vision_model()
        response = model.generate_content([prompt, image])
        text = response.text
    """
    from services.ai_providers import OpenAICompatModel, is_gemini_active

    if not is_gemini_active():
        return OpenAICompatModel()
    return _GeminiModelWrapper(get_gemini_client())


class _GeminiModelWrapper:
    """Thin wrapper around google.genai.Client to provide the old GenerativeModel interface."""

    def __init__(self, client: genai.Client):
        self._client = client

    def generate_content(self, contents):
        """Call generate_content on the Gemini API (synchronous).

        On a model-not-found error, re-resolves the working model once via
        ``get_working_model_force()`` and retries exactly once.

        Args:
            contents: A string, list of strings, PIL images, or mixed list
                     (same format accepted by both old and new SDK).

        Returns:
            GenerateContentResponse with .text attribute.
        """
        try:
            return self._client.models.generate_content(
                model=get_working_model_sync(),
                contents=contents,
            )
        except Exception as e:
            text = str(e).lower()
            is_model_gone = ("not_found" in text and "model" in text) or (
                "404" in text and "model" in text
            )
            if not is_model_gone:
                raise
            logger.warning("Model not found during generation; re-resolving…")
            new_model = get_working_model_force()
            return self._client.models.generate_content(
                model=new_model,
                contents=contents,
            )

    async def async_generate_content(self, contents):
        """Non-blocking wrapper around generate_content.

        Runs the synchronous Gemini SDK call in a thread pool executor
        so it doesn't block the asyncio event loop.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.generate_content, contents)


def get_author_instruction() -> str:
    """Get the author instruction for profile creation prompts."""
    author = get_author_name()
    return (
        f"AUTHOR:\n"
        f"• Set the 'author' field in the profile JSON to: \"{author}\"\n"
        f"• This name will appear as the profile creator on the Meticulous device\n\n"
    )


def build_advanced_customization_section(advanced_customization: Optional[str]) -> str:
    """Build the advanced customization section for the prompt.

    These are MANDATORY equipment and extraction parameters that MUST be followed.
    """
    if not advanced_customization:
        return ""

    return (
        f"⚠️ MANDATORY EQUIPMENT & EXTRACTION PARAMETERS (MUST BE USED EXACTLY):\n"
        f"{advanced_customization}\n\n"
        f"CRITICAL: You MUST configure the profile to use these EXACT values. "
        f"These are non-negotiable hardware/extraction constraints:\n"
        f"• If a temperature is specified, set the profile temperature to that EXACT value\n"
        f"• If a dose is specified, the profile MUST be designed for that EXACT dose\n"
        f"• If max pressure/flow is specified, NO stage should exceed those limits\n"
        f"• If basket size/type is specified, account for it in your dose and extraction design\n"
        f"• If bottom filter is specified, mention it in preparation notes\n\n"
    )


# =============================================================================
# Taste Compass — cache key helpers
# =============================================================================


def compute_taste_hash(
    taste_x: float | None,
    taste_y: float | None,
    taste_descriptors: list[str] | None,
) -> str | None:
    """Return a short hash for taste data, or None when no taste input is present.

    Used to differentiate cached analyses: same shot *without* taste data keeps
    its original cache entry, while taste-aware analyses get a separate one.
    """
    has_coords = taste_x is not None and taste_y is not None
    has_desc = bool(taste_descriptors)
    if not has_coords and not has_desc:
        return None

    parts: list[str] = []
    if has_coords:
        parts.append(f"{taste_x:.4f},{taste_y:.4f}")
    if has_desc:
        parts.append(",".join(sorted(taste_descriptors)))

    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]
