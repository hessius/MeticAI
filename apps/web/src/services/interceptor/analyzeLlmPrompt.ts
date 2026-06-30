import { ANALYSIS_KNOWLEDGE, FEW_SHOT_ANALYSIS_EXAMPLE, buildFactSheet } from '../ai/analysisKnowledge'
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
  graphSamples?: unknown[]
}

export function buildAnalyzeLlmPrompt(input: AnalyzeLlmPromptInput): string {
  const {
    profileName, temperature, targetWeight, profileDescription,
    profileVars, cleanStages, facts, tasteContext, graphSamples = [],
  } = input
  return `You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

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

## Full Local Analysis
This is the complete algorithmic analysis of the shot. Use this data to inform your expert analysis.

IMPORTANT: Each stage includes 'cumulative_weight_at_end' which shows the total weight when that stage ended.
If a stage ended early but the cumulative weight was near the target weight, the shot likely terminated
correctly due to reaching the final weight target - this is NORMAL and EXPECTED behavior.
A stage that appears "short" may simply mean the target yield was reached, which is the correct outcome.

IMPORTANT: The 'final_weight_g' in shot_summary is the actual settled weight AFTER the machine's piston retraction completes.
The Meticulous machine issues a stop signal BEFORE the target weight is reached, accounting for residual flow that will drip
into the cup during piston retraction. This means the final weight accurately reflects the total liquid in the cup.
Do NOT penalize the shot for weight deviation unless 'weight_deviation_pct' exceeds ±5%.

## Shot Facts (digested)
${buildFactSheet(facts)}

### Graph Sample Points
${JSON.stringify(graphSamples, null, 2)}
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
