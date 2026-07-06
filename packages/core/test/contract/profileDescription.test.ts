import { describe, test, expect } from "vitest"
import {
  buildStaticProfileDescription,
  resolveDescriptionPlaceholders,
  UNIT_BY_TYPE,
  type ProfileVariable,
} from "../../src/logic/profileDescription"

describe("resolveDescriptionPlaceholders", () => {
  test("resolves paired and unpaired real variable references with type units", () => {
    const variables: ProfileVariable[] = [
      { key: "pressure_peak", value: 9 },
      { key: "flow_target", value: 2.5 },
      { key: "time_bloom", value: 12 },
      { key: "weight_yield", value: 36 },
    ]

    expect(
      resolveDescriptionPlaceholders(
        "Hold $pressure_peak$ then $flow_target for $time_bloom$ to reach $weight_yield.",
        variables,
      ),
    ).toBe("Hold 9 bar then 2.5 ml/s for 12 s to reach 36 g.")
    expect(UNIT_BY_TYPE).toEqual({
      pressure: " bar",
      flow: " ml/s",
      time: " s",
      weight: " g",
    })
  })

  test("replaces longest matching key first when one key prefixes another", () => {
    const variables: ProfileVariable[] = [
      { key: "pressure", value: 7 },
      { key: "pressure_long", value: 9 },
    ]

    expect(resolveDescriptionPlaceholders("Use $pressure_long$ then $pressure$.", variables)).toBe(
      "Use 9 bar then 7 bar.",
    )
  })

  test("strips invented placeholders, unescapes markdown characters, and tidies punctuation", () => {
    expect(
      resolveDescriptionPlaceholders(
        "Sweet $invented_token$ , bright $pressure\\_max$ and syrupy\\* finish .",
        [{ key: "pressure_max", value: 8.5 }],
      ),
    ).toBe("Sweet, bright 8.5 bar and syrupy* finish.")
  })

  test("returns an empty string for null or undefined input", () => {
    expect(resolveDescriptionPlaceholders(null)).toBe("")
    expect(resolveDescriptionPlaceholders(undefined)).toBe("")
  })
})

describe("buildStaticProfileDescription", () => {
  test("builds a structured description from pre-infusion, ramp, temperature, yield, and time", () => {
    const profile: Parameters<typeof buildStaticProfileDescription>[0] = {
      name: "Citrus Climber",
      temperature: 93,
      final_weight: 36,
      stages: [
        { name: "Pre-infusion", dynamics: "flat", dynamics_points: [[0, 2], [8, 2]] },
        { name: "Ramp Up", dynamics: "ramp", dynamics_points: [[0, 2], [18, 9]] },
      ],
    }

    const output = buildStaticProfileDescription(profile)

    expect(output).toContain("Profile Created: Citrus Climber")
    expect(output).toContain("Description:\nA 2-stage extraction featuring pre-infusion, ramp brewed at 93°C targeting ~36g yield.")
    expect(output).toContain("Preparation:")
    expect(output).toContain("• Temperature: 93°C")
    expect(output).toContain("• Target Yield: 36g")
    expect(output).toContain("• Expected Time: ~26s")
    expect(output).toContain("Why This Works:")
    expect(output).toContain("Special Notes:")
    expect(buildStaticProfileDescription(profile)).toBe(output)
  })

  test("uses an explicit description and profile defaults when metadata is absent", () => {
    const output = buildStaticProfileDescription({
      name: "Author Notes",
      description: "A custom author description.",
      stages: [],
    })

    expect(output).toContain("Profile Created: Author Notes")
    expect(output).toContain("Description:\nA custom author description.")
    expect(output).toContain("• Temperature: Use profile default")
    expect(output).toContain("• Target Yield: Use profile default")
    expect(output).toContain("• Expected Time: Not specified")
  })

  test("detects bloom and flat pressure traits and falls back to imported profile naming", () => {
    const output = buildStaticProfileDescription({
      temperature: 90,
      final_weight: 42,
      stages: [
        { name: "Bloom Soak", dynamics_points: [[0, 3], [10, 3]] },
        { name: "Main", dynamics_points: [[0, 9], [25, 9.1]] },
      ],
    })

    expect(output).toContain("Profile Created: Imported Profile")
    expect(output).toContain("A 2-stage extraction featuring bloom, flat brewed at 90°C targeting ~42g yield.")
    expect(output).toContain("• Expected Time: ~35s")
  })
})
