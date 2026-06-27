export interface Grant {
  Type: string;
  Name: string;
  Sponsor: string;
  "Source URL": string;
  "Region/Eligibility": string;
  "Deadline/Next Cohort": string;
  Cadence: string;
  Benefits: string;
  "Eligibility (key conditions)": string;
  Stage: string;
  "Non-dilutive?": string;
  "Stack Required?": string;
  Relevance: number | string;
  Fit: number | string;
  Ease: number | string;
  "Weighted Score": number | string;
  "Notes/Actions": string;
  score?: number;
  source?: "live" | "db";
  ai_score?: number;
  ai_summary?: string;
  ai_tier?: string;
  ai_scored_at?: string;
  pdf_url?: string;
  [key: string]: string | number | undefined;
}

export type SortDir = "asc" | "desc" | false;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FilterState {
  type: string;
  stage: string;
  minScore: string;
  deadlineBefore: string;
  search: string;
  savedOnly: boolean;
}
