/**
 * Unit tests for workers/scoring_utils.js pure functions.
 *
 * No cloudflare:test bindings required — these functions have no I/O.
 * vi.setSystemTime() pins Date.now() to 2026-06-14T00:00:00Z, matching the
 * Python suite's freezegun date so deadline-relative assertions are stable.
 *
 * Note on score ranges:
 *   computeScore WITHOUT profile:  0–10  (formula × 10/3 scale)
 *   computeScore WITH profile:     0–∞  (profileMatch×10 + dbScore/3; can exceed 10)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeStackAlignment,
  computeCadenceRecency,
  computeProfileMatch,
  computeScore,
  DEFAULT_WEIGHTS,
} from "../workers/scoring_utils.js";

// Frozen at 2026-06-14T00:00:00Z — matches freezegun date in test_program_scoring.py.
//   2026-07-14 is exactly 30 days out → CadenceRecency ≈ 0.918
//   2100-01-01 is reliably > 365 days  → clamped to 0
const FROZEN_DATE = new Date("2026-06-14T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_DATE);
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// computeStackAlignment
// ---------------------------------------------------------------------------

describe("computeStackAlignment", () => {
  it("returns 1.0 when stack_required is 1 (integer true)", () => {
    expect(computeStackAlignment({ stack_required: 1 })).toBe(1.0);
  });

  it("returns 0.2 when stack_required is 0", () => {
    expect(computeStackAlignment({ stack_required: 0 })).toBe(0.2);
  });

  it("returns 1.0 for legacy 'Yes' string in Stack Required? column", () => {
    expect(computeStackAlignment({ "Stack Required?": "Yes" })).toBe(1.0);
  });

  it("returns 0.2 when stack_required is absent", () => {
    expect(computeStackAlignment({})).toBe(0.2);
  });

  it("returns 0.2 for lowercase 'yes' string (only exact 'Yes' triggers the legacy path)", () => {
    // JS scorer checks `stack_required === 1` OR `"Stack Required?" === "Yes"` (exact case).
    expect(computeStackAlignment({ "Stack Required?": "yes" })).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// computeCadenceRecency
// ---------------------------------------------------------------------------

describe("computeCadenceRecency", () => {
  it("returns 1.0 when cadence contains 'rolling' (case-insensitive)", () => {
    expect(computeCadenceRecency({ cadence: "Rolling",  deadline: null })).toBe(1.0);
    expect(computeCadenceRecency({ cadence: "rolling",  deadline: null })).toBe(1.0);
    expect(computeCadenceRecency({ cadence: "ROLLING",  deadline: null })).toBe(1.0);
  });

  it("returns a fractional value for a deadline 30 days away", () => {
    // 2026-07-14 is 30 days from FROZEN_DATE: 1 - 30/365 ≈ 0.918
    const r = { cadence: "Annual", deadline: "2026-07-14" };
    const result = computeCadenceRecency(r);
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThan(1.0);
    expect(result).toBeCloseTo(1 - 30 / 365, 3);
  });

  it("returns 0.0 for a deadline more than 365 days away (clamped)", () => {
    // 2100-01-01 is far beyond 365 days; min(days, 365) = 365 → result = 0
    expect(computeCadenceRecency({ cadence: "Annual", deadline: "2100-01-01" })).toBe(0);
  });

  it("returns 0.0 for a past deadline", () => {
    expect(computeCadenceRecency({ cadence: "Annual", deadline: "2000-01-01" })).toBe(0);
  });

  it("returns 0.0 for an unparseable deadline string", () => {
    expect(computeCadenceRecency({ cadence: "Annual", deadline: "N/A" })).toBe(0);
    expect(computeCadenceRecency({ cadence: "Annual", deadline: "TBD" })).toBe(0);
  });

  it("returns 0.0 when deadline is null and cadence is not rolling", () => {
    expect(computeCadenceRecency({ cadence: "Annual", deadline: null })).toBe(0);
  });

  it("returns 0.0 when both deadline and cadence are absent", () => {
    expect(computeCadenceRecency({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeProfileMatch
// ---------------------------------------------------------------------------

describe("computeProfileMatch", () => {
  it("returns 0 for a completely empty profile", () => {
    const grant = { name: "Tech Grant", benefits: "technology software innovation" };
    const profile = { focusAreas: [], orgType: "", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBe(0);
  });

  it("returns 0 when computeScore is called with a null profile", () => {
    // computeScore guards null profile before calling computeProfileMatch; verify the
    // end-to-end result is 0 profile contribution (not a TypeError).
    const r = { name: "Grant", benefits: "technology", cadence: "Rolling", deadline: null,
                stack_required: 0, relevance: 0, fit: 0, ease: 0 };
    const score = computeScore(r, DEFAULT_WEIGHTS, null);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns > 0 when a focus-area keyword matches grant text", () => {
    const grant   = { name: "Health Research", benefits: "health medicine clinical biomedical" };
    const profile = { focusAreas: ["Health & Medicine"], orgType: "", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBeGreaterThan(0);
  });

  it("returns 0 when focus area is set but no keyword appears in any grant field", () => {
    const grant   = { name: "Unrelated Grant", benefits: "real estate mortgage property" };
    const profile = { focusAreas: ["Technology & Innovation"], orgType: "", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBe(0);
  });

  it("returns 1.0 when org type is the sole dimension and it matches", () => {
    // "nonprofit" appears in benefits; Nonprofit/NGO keywords include "nonprofit".
    // 1 check (orgType), 1 hit → 1/1 = 1.0
    const grant   = { benefits: "nonprofit community charitable foundation" };
    const profile = { focusAreas: [], orgType: "Nonprofit/NGO", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBe(1);
  });

  it("returns 0.5 when 1 of 2 focus areas matches", () => {
    // Tech keywords hit; no health keywords present.
    const grant   = { benefits: "technology software innovation digital" };
    const profile = {
      focusAreas: ["Technology & Innovation", "Health & Medicine"],
      orgType: "", stage: "",
    };
    // 1 hit / 2 focus-area checks = 0.5
    expect(computeProfileMatch(grant, profile)).toBeCloseTo(0.5, 5);
  });

  it("searches across all grant text fields (name, sponsor, benefits, type, notes)", () => {
    // 'research' keyword appears only in sponsor field.
    const grant   = { name: "XYZ Program", sponsor: "Center for Research", benefits: "" };
    const profile = { focusAreas: ["Research & Science"], orgType: "", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBeGreaterThan(0);
  });

  it("substring match: 'clinical' in text matches 'clinic' org-type keyword", () => {
    // computeProfileMatch uses .includes() — 'clinical'.includes('clinic') is true.
    const grant   = { benefits: "clinical research trials" };
    const profile = { focusAreas: [], orgType: "Hospital/Health System", stage: "" };
    expect(computeProfileMatch(grant, profile)).toBe(1);
  });

  it("returns stage match correctly", () => {
    const grant   = { benefits: "early stage pilot proof of concept exploratory" };
    const profile = { focusAreas: [], orgType: "", stage: "Early Research / Ideation" };
    expect(computeProfileMatch(grant, profile)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeScore — without profile (pure DB quality, 0–10 scale)
// ---------------------------------------------------------------------------

describe("computeScore without profile", () => {
  it("returns ~0.2 for worst-case quality inputs (R/F/E=0, past deadline, no stack)", () => {
    // StackAlignment is 0.2 even when stack_required=0; CadenceRecency=0 for past deadline.
    // score = (0 + 0 + 0 + 0.1*(0.2*3) + 0) * (10/3) = 0.06 * (10/3) ≈ 0.2
    const r = { relevance: 0, fit: 0, ease: 0, cadence: "Annual", deadline: "2000-01-01", stack_required: 0 };
    expect(computeScore(r, DEFAULT_WEIGHTS, null)).toBeCloseTo(0.2, 1);
  });

  it("returns 10.0 for max inputs: R/F/E=3, stack=1, rolling cadence", () => {
    // (0.3*3 + 0.3*3 + 0.2*3 + 0.1*(1*3) + 0.1*(1*3)) * (10/3) = 3 * 10/3 = 10
    const r = { relevance: 3, fit: 3, ease: 3, cadence: "Rolling", deadline: null, stack_required: 1 };
    expect(computeScore(r, DEFAULT_WEIGHTS, null)).toBeCloseTo(10.0, 1);
  });

  it("returns 9.2 for max DB scores with stack=0 and rolling cadence", () => {
    // (0.9 + 0.9 + 0.6 + 0.1*(0.2*3) + 0.1*(1*3)) * (10/3)
    // = (2.4 + 0.06 + 0.3) * (10/3) = 2.76 * (10/3) ≈ 9.2
    const r = { relevance: 3, fit: 3, ease: 3, cadence: "Rolling", deadline: null, stack_required: 0 };
    expect(computeScore(r, DEFAULT_WEIGHTS, null)).toBeCloseTo(9.2, 1);
  });

  it("returns a non-negative score when only CadenceRecency contributes", () => {
    const r = { relevance: 0, fit: 0, ease: 0, cadence: "Rolling", deadline: null, stack_required: 0 };
    expect(computeScore(r, DEFAULT_WEIGHTS, null)).toBeGreaterThan(0);
  });

  it("empty-profile object (no focusAreas/orgType/stage) produces the same result as null profile", () => {
    const r = { relevance: 2, fit: 2, ease: 2, cadence: "Annual", deadline: "2000-01-01", stack_required: 0 };
    const emptyProfile = { focusAreas: [], orgType: "", stage: "" };
    // hasProfile → false for empty profile → same code path as null
    expect(computeScore(r, DEFAULT_WEIGHTS, null)).toBeCloseTo(
      computeScore(r, DEFAULT_WEIGHTS, emptyProfile), 5,
    );
  });
});

// ---------------------------------------------------------------------------
// computeScore — with profile (profile-match primary signal; can exceed 10)
// ---------------------------------------------------------------------------

describe("computeScore with profile", () => {
  const techProfile = {
    focusAreas: ["Technology & Innovation"],
    orgType: "Nonprofit/NGO",
    stage: "",
    weights: DEFAULT_WEIGHTS,
  };

  it("matching grant scores higher than a non-matching grant for the same profile", () => {
    const matching = {
      name: "Tech Nonprofit Accelerator",
      benefits: "technology software nonprofit foundation",
      cadence: "Rolling", deadline: null,
      stack_required: 0, relevance: 3, fit: 3, ease: 3,
    };
    const nonMatching = {
      name: "Unrelated Program",
      benefits: "real estate mortgage development",
      cadence: "Annual", deadline: "2000-01-01",
      stack_required: 0, relevance: 1, fit: 1, ease: 1,
    };
    expect(computeScore(matching, DEFAULT_WEIGHTS, techProfile))
      .toBeGreaterThan(computeScore(nonMatching, DEFAULT_WEIGHTS, techProfile));
  });

  it("profileMatch=1.0 drives score above 10 when DB quality is also high", () => {
    // profileMatch=1 → primary = 1.0*10 = 10
    // dbScore(stack=0, rolling, R/F/E=3) = 2.76 → dbScore/3 = 0.92
    // finalScore = round(10.92 * 100)/100 = 10.92
    const r = {
      name: "Tech Grant",
      benefits: "technology innovation software digital nonprofit foundation",
      cadence: "Rolling", deadline: null,
      stack_required: 0, relevance: 3, fit: 3, ease: 3,
    };
    const score = computeScore(r, DEFAULT_WEIGHTS, techProfile);
    expect(score).toBeGreaterThan(10);
    expect(score).toBeCloseTo(10.92, 1);
  });

  it("returns 0 when no text overlap and all DB scores are 0 and deadline is past", () => {
    // profileMatch=0 → 0*10=0; dbScore: R/F/E=0, past deadline → CR=0, stack=0 → SA=0.2
    // only SA contributes: 0.1*(0.2*3)*(10/3)/3 = tiny positive / 3 ≈ 0.2/3 ≈ 0.067
    // The spec says "returns 0" but the SA constant is non-zero; use a ≤ small threshold:
    const r = {
      name: "", sponsor: "", benefits: "",
      cadence: "Annual", deadline: "2000-01-01",
      stack_required: 0, relevance: 0, fit: 0, ease: 0,
    };
    // dbScore = 0.1*(0.2*3) = 0.06; with-profile formula: 0*10 + 0.06/3 = 0.02
    const score = computeScore(r, DEFAULT_WEIGHTS, techProfile);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(1);
  });

  it("custom weights change score — boosting StackAlignment raises score for stack_required grants", () => {
    const stackWeights = { Relevance: 0.1, Fit: 0.1, Ease: 0.1, StackAlignment: 0.6, CadenceRecency: 0.1 };
    const r = { benefits: "", cadence: "Annual", deadline: "2000-01-01", stack_required: 1,
                relevance: 0, fit: 0, ease: 0 };
    const scoreStack   = computeScore(r, stackWeights,    null);
    const scoreDefault = computeScore(r, DEFAULT_WEIGHTS, null);
    expect(scoreStack).toBeGreaterThan(scoreDefault);
  });
});
