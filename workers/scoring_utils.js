/**
 * Scoring utilities shared by the profile matcher worker.
 *
 * These are ported directly from worker.js (lines 197–338) so the profile
 * matcher produces scores identical to what the web app displays.  The
 * inline copies in worker.js are intentionally left unchanged to avoid
 * risking the existing web flow.
 */

export const DEFAULT_WEIGHTS = {
  Relevance: 0.3,
  Fit: 0.3,
  Ease: 0.2,
  StackAlignment: 0.1,
  CadenceRecency: 0.1,
};

export const FOCUS_AREA_KEYWORDS = {
  "Health & Medicine":         ["health", "medicine", "medical", "clinical", "biomedical", "disease", "drug", "therapeutics", "patient"],
  "Education & Workforce":     ["education", "workforce", "training", "learning", "student", "school", "academic", "career"],
  "Technology & Innovation":   ["technology", "innovation", "tech", "software", "digital", "engineering", "data", "ai", "computing"],
  "Housing & Community":       ["housing", "community", "neighborhood", "affordable", "urban", "rural", "infrastructure"],
  "Environment & Climate":     ["environment", "climate", "energy", "sustainability", "clean", "emissions", "carbon", "ecology"],
  "Agriculture & Food":        ["agriculture", "food", "farm", "crop", "nutrition", "rural", "livestock"],
  "Social Services":           ["social", "welfare", "poverty", "disability", "elderly", "child", "family", "services"],
  "Arts & Humanities":         ["arts", "humanities", "culture", "museum", "heritage", "creative", "media"],
  "International Development": ["international", "global", "developing", "foreign", "overseas", "aid"],
  "Veterans & Military":       ["veteran", "military", "defense", "armed forces", "service member"],
  "Research & Science":        ["research", "science", "scientific", "laboratory", "study", "investigation"],
  "Justice & Safety":          ["justice", "safety", "law", "crime", "court", "police", "legal", "equity"],
};

export const ORG_TYPE_KEYWORDS = {
  "Nonprofit/NGO":                   ["nonprofit", "ngo", "foundation", "charitable", "501(c)"],
  "University/Research Institution": ["university", "college", "academic", "institution", "research institution"],
  "Startup/Small Business":          ["startup", "small business", "entrepreneur", "company", "commercial", "industry"],
  "Government/Tribal":               ["government", "tribal", "municipality", "state", "federal", "public"],
  "Individual Researcher":           ["individual", "researcher", "investigator", "pi ", "principal investigator"],
  "Hospital/Health System":          ["hospital", "health system", "clinic", "medical center"],
};

export const STAGE_KEYWORDS = {
  "Early Research / Ideation": ["early", "exploratory", "pilot", "proof of concept", "ideation", "basic research", "preliminary"],
  "Pilot / Proof of Concept":  ["pilot", "proof of concept", "demonstration", "feasibility"],
  "Growth / Scaling":          ["scale", "scaling", "expansion", "growth", "replication"],
  "Established Program":       ["established", "sustained", "continuation", "operational", "ongoing"],
};

/** Returns a 0–1 match score for how well a grant row fits the user profile. */
export function computeProfileMatch(r, profile) {
  const focusAreas = Array.isArray(profile.focusAreas) ? profile.focusAreas : [];
  const orgType    = profile.orgType  || "";
  const stage      = profile.stage    || "";

  if (!focusAreas.length && !orgType && !stage) return 0;

  const text = [
    r.name        || r.Name        || "",
    r.sponsor     || r.Sponsor     || "",
    r.benefits    || r.Benefits    || "",
    r.eligibility_conditions || r["Eligibility (key conditions)"] || "",
    r.region_eligibility || r["Region / Eligibility"] || "",
    r.type        || r.Type        || "",
    r.notes       || r["Notes / Actions"] || "",
  ].join(" ").toLowerCase();

  let hits = 0, checks = 0;

  if (focusAreas.length) {
    let areaHits = 0;
    for (const fa of focusAreas) {
      const kws = FOCUS_AREA_KEYWORDS[fa] || [];
      if (kws.some(kw => text.includes(kw))) areaHits++;
    }
    checks += focusAreas.length;
    hits += areaHits;
  }

  const orgKeywords = ORG_TYPE_KEYWORDS[orgType] || [];
  if (orgKeywords.length) {
    checks++;
    if (orgKeywords.some(kw => text.includes(kw))) hits++;
  }

  const stageKeywords = STAGE_KEYWORDS[stage] || [];
  if (stageKeywords.length) {
    checks++;
    if (stageKeywords.some(kw => text.includes(kw))) hits++;
  }

  return checks ? hits / checks : 0;
}

/** Returns 1.0 if the grant requires the user's stack, else 0.2. */
export function computeStackAlignment(r) {
  return (r.stack_required === 1 || r["Stack Required?"] === "Yes") ? 1.0 : 0.2;
}

/** Returns 0–1 based on deadline proximity; 1.0 for rolling. */
export function computeCadenceRecency(r) {
  const cadence = String(r.cadence || r.Cadence || "").toLowerCase();
  if (cadence.includes("rolling")) return 1.0;
  const raw = r.deadline || r["Deadline / Next Cohort"];
  if (!raw) return 0;
  const deadline = new Date(raw);
  if (isNaN(deadline.getTime())) return 0;
  const daysUntil = (deadline.getTime() - Date.now()) / 86400000;
  if (daysUntil < 0) return 0;
  return Math.max(0, Math.min(1, 1 - daysUntil / 365));
}

/**
 * Returns a 0–10 composite score.
 *
 * With a profile: profile match (0–1 → 0–10) is the primary signal;
 * DB quality scores act as a tiebreaker within the same match tier.
 * Without a profile: pure DB quality scores scaled to 0–10.
 */
export function computeScore(r, weights, profile) {
  const profileMatch = profile ? computeProfileMatch(r, profile) : 0;
  const hasProfile = profile && (
    (Array.isArray(profile.focusAreas) && profile.focusAreas.length) ||
    profile.orgType || profile.stage
  );

  const relevance = parseFloat(r.relevance || r.Relevance) || 0;
  const fit       = parseFloat(r.fit       || r.Fit)       || 0;
  const ease      = parseFloat(r.ease      || r.Ease)      || 0;
  const stack     = computeStackAlignment(r);
  const cadence   = computeCadenceRecency(r);

  if (hasProfile) {
    const w = weights || DEFAULT_WEIGHTS;
    const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const dbScore = ((w.Relevance      ?? 0) / total) * relevance
                  + ((w.Fit            ?? 0) / total) * fit
                  + ((w.Ease           ?? 0) / total) * ease
                  + ((w.StackAlignment ?? 0) / total) * (stack * 3)
                  + ((w.CadenceRecency ?? 0) / total) * (cadence * 3);
    return Math.round((profileMatch * 10 + dbScore / 3) * 100) / 100;
  }

  const w = weights || DEFAULT_WEIGHTS;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Math.round((
      ((w.Relevance      ?? 0) / total) * relevance
    + ((w.Fit            ?? 0) / total) * fit
    + ((w.Ease           ?? 0) / total) * ease
    + ((w.StackAlignment ?? 0) / total) * (stack * 3)
    + ((w.CadenceRecency ?? 0) / total) * (cadence * 3)
  ) * (10 / 3) * 100) / 100;
}

/**
 * Builds the HTML body for a grant-match notification email.
 *
 * Returns { subject, html } — a pure function, no I/O.
 */
export function buildEmailSummary(username, matches) {
  const count = matches.length;
  const subject = `${count} new grant match${count === 1 ? "" : "es"} for ${username}`;

  const rows = matches
    .sort((a, b) => b.score - a.score)
    .map(({ grant, score }) => {
      const deadline = grant.deadline
        ? `<span style="color:#555">Deadline: ${grant.deadline}</span>`
        : `<span style="color:#888">Rolling / open</span>`;
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee">
            <strong style="font-size:15px">${escapeHtml(grant.name || "Unnamed Grant")}</strong>
            <br>
            <span style="color:#555">Sponsor: ${escapeHtml(grant.sponsor || "—")}</span>
            &nbsp;|&nbsp;${deadline}
            &nbsp;|&nbsp;<strong style="color:#1a56db">Score: ${score.toFixed(1)}</strong>
          </td>
        </tr>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <h2 style="color:#1a56db">FoundationPlanner: ${count} new grant match${count === 1 ? "" : "es"}</h2>
  <p>Hello <strong>${escapeHtml(username)}</strong>,</p>
  <p>We found ${count} new grant opportunit${count === 1 ? "y" : "ies"} matching your profile:</p>
  <table style="width:100%;border-collapse:collapse">
    ${rows}
  </table>
  <p style="margin-top:24px;font-size:13px;color:#888">
    Log in to FoundationPlanner to view details, add notes, and track deadlines.<br>
    To update your notification preferences, visit your profile settings.
  </p>
</body>
</html>`;

  return { subject, html };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
