import { ANALYSIS_KNOWLEDGE, FEW_SHOT_ANALYSIS_EXAMPLE, buildFactSheet } from '../ai/analysisKnowledge'
import { PROFILING_KNOWLEDGE } from '../ai/profilePromptFull'
import type { ShotFacts } from '../../lib/shotFacts'

export interface AnalyzeLlmPromptInput {
  profileName: string
  temperature: number | string | null
  targetWeight: number | string | null
  profileDescription: string
  profileVars: unknown[]
  cleanStages: unknown[]
  facts: ShotFacts
  tasteContext: string
}

export function buildAnalyzeLlmPrompt(input: AnalyzeLlmPromptInput): string {
  const {
    profileName, temperature, targetWeight, profileDescription,
    profileVars, cleanStages, facts, tasteContext,
  } = input
  return `You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

## Expert Knowledge
${PROFILING_KNOWLEDGE}

## Analysis Framework
${ANALYSIS_KNOWLEDGE}

## Profile Being Used
Name: ${profileName}
Temperature: ${temperature ?? 'Not set'}°C
Target Weight: ${targetWeight ?? 'Not set'}g

### Profile Description
${profileDescription || 'No description provided - analyze the profile structure to understand intent.'}

### Profile Variables
${JSON.stringify(profileVars, null, 2)}

### Profile Stages
${JSON.stringify(cleanStages, null, 2)}

## Shot Facts (digested — authoritative; trust over raw telemetry)
Each stage lists its exit classification. A Targeted exit means the stage reached its intended
outcome (e.g. its weight target); a Failsafe exit means a backstop fired before the real target.
A Targeted exit — including a short stage that hit its weight target — is NORMAL and CORRECT
behavior; never describe it as "early termination". The final weight reflects the settled weight
after the machine's piston retraction completes, so do NOT penalize weight deviation unless it
exceeds ±5%.

${buildFactSheet(facts)}
${tasteContext ? `\n${tasteContext}\n` : ''}
${FEW_SHOT_ANALYSIS_EXAMPLE}

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these 5 section headers with the exact format shown (## followed by number, period, space, then title)
2. Each section MUST have the subsection headers shown (bold text with colon, like **What Happened:**)
3. ALL content under subsections MUST be bullet points starting with "- "
4. Keep bullet points concise (1-2 sentences max per bullet)
5. Do NOT add extra sections or subsections beyond what's specified

## 1. Shot Performance

**What Happened:**
- [Stage-by-stage description of the extraction]
- [Notable events: pressure spikes, flow restrictions, early/late stage exits]
- [Final weight accuracy relative to target]

**Assessment:** [Choose exactly one: Good / Acceptable / Needs Improvement / Problematic]

## 2. Root Cause Analysis

**Primary Factors:**
- [Most likely cause with brief explanation]
- [Second most likely cause if applicable]

**Secondary Considerations:**
- [Other contributing factors]
- [Environmental or equipment factors if relevant]

## 3. Setup Recommendations

**Priority Changes:**
- [Most important change - be specific with numbers when possible]
- [Second priority change]

**Additional Suggestions:**
- [Other tweaks to consider]

## 4. Profile Recommendations

**Recommended Adjustments:**
- [Specific profile changes: timing, triggers, targets]
- [Variable value changes if applicable]

**Reasoning:**
- [Why these changes would improve the shot]

## 5. Profile Design Observations

**Strengths:**
- [Well-designed aspects of this profile]

**Potential Improvements:**
- [Exit trigger or safety limit suggestions]
- [Robustness improvements]

Focus on actionable insights. Be specific with numbers where possible (e.g., "grind 1-2 steps finer" not just "grind finer").

## Structured Recommendations (MANDATORY)

After your analysis sections, you MUST output a structured JSON block with specific, actionable profile variable recommendations.
Use EXACTLY this format — the markers are parsed programmatically:

RECOMMENDATIONS_JSON:
[
  {
    "variable": "<variable key from the profile, e.g. 'pressure', 'temperature'>",
    "current_value": <current numeric value>,
    "recommended_value": <suggested numeric value>,
    "stage": "<stage name this applies to, or 'global' for top-level settings>",
    "confidence": "<high|medium|low>",
    "reason": "<one-sentence explanation>"
  }
]
END_RECOMMENDATIONS_JSON

Rules for recommendations:
- Only include recommendations where you have a SPECIFIC numeric change to suggest
- Use actual variable keys from the Profile Variables section above
- For top-level settings (temperature, final_weight), use stage="global"
- For stage-specific changes, use the stage name from Profile Stages
- confidence: "high" = strong evidence from data, "medium" = likely beneficial, "low" = worth trying
- If no recommendations apply, output an empty array: RECOMMENDATIONS_JSON:\n[]\nEND_RECOMMENDATIONS_JSON
`
}
