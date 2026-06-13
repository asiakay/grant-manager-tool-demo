export const FOCUS_AREA_KEYWORDS: Record<string, string[]> = {
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

export const ORG_TYPE_KEYWORDS: Record<string, string[]> = {
  "Nonprofit/NGO":                   ["nonprofit", "ngo", "foundation", "charitable", "501(c)"],
  "University/Research Institution": ["university", "college", "academic", "institution", "research institution"],
  "Startup/Small Business":          ["startup", "small business", "entrepreneur", "company", "commercial", "industry"],
  "Government/Tribal":               ["government", "tribal", "municipality", "state", "federal", "public"],
  "Individual Researcher":           ["individual", "researcher", "investigator", "pi ", "principal investigator"],
  "Hospital/Health System":          ["hospital", "health system", "clinic", "medical center"],
};

export const STAGE_KEYWORDS: Record<string, string[]> = {
  "Early Research / Ideation": ["early", "exploratory", "pilot", "proof of concept", "ideation", "basic research", "preliminary"],
  "Pilot / Proof of Concept":  ["pilot", "proof of concept", "demonstration", "feasibility"],
  "Growth / Scaling":          ["scale", "scaling", "expansion", "growth", "replication"],
  "Established Program":       ["established", "sustained", "continuation", "operational", "ongoing"],
};
