// Shared types for the NTP MTR Field app

export interface Stakeholder {
  id: number;
  enumerator: 1 | 2 | 0;
  name: string;
  full_name: string;
  policy_items: string[];
  implementation_items: string[];
}

export interface Option { value: number; label: string; }

export type QuestionType =
  | "text"
  | "date"
  | "single"
  | "multi"
  | "likert5"
  | "auto"
  | "stakeholder_picker";

export interface Question {
  code: string;
  section: string;
  sub: string;
  text: string;
  type: QuestionType;
  options: Option[];
  skip: string;
  validation: string;
  variable: string;
  notes: string;
  required: boolean;
}

export interface Section {
  code: string;
  title: string;
  questions: Question[];
}

export interface Questionnaire {
  title: string;
  subtitle: string;
  target_minutes: number;
  sections: Section[];
  skip_rules: Record<string, any>;
  t2_barrier_options: string[];
  t2_status_options: Option[];
  t2_rating_options: Option[];
}

export type AnswerValue = string | number | number[] | null;

export interface T2Item {
  /** 1-indexed position */
  index: number;
  text: string;
  status: number | null;    // 1-4
  rating: number | null;    // 1-5 (or null when status=4)
  rationale: string;
}

export interface GpsCoords {
  latitude: number;
  longitude: number;
  accuracy: number;         // metres
  capturedAt: string;       // ISO
}

export interface AdditionalContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface Interview {
  /** Unique local id: `${enumerator}-${stakeholderId}-${timestamp}` */
  id: string;
  enumerator: 1 | 2;
  stakeholderId: number;
  stakeholderName: string;
  startedAt: string;        // ISO — when enumerator first opened the interview
  updatedAt: string;        // ISO
  completedAt?: string;     // ISO when marked complete locally
  submittedAt?: string;     // ISO when successfully submitted to server
  submittedId?: number;     // Supabase row ID after successful submission
  status: "draft" | "completed";
  answers: Record<string, AnswerValue>;   // Tier 1 answers by Q code
  t2_items: T2Item[];
  barriers: number[];       // T2_BAR multi-select values
  barrier_other: string;    // T2_BAR_OTH
  recommendation: string;   // T2_OPEN
  enumerator_comments: string;   // enumerator's own impressions (not read to respondent)
  gps?: GpsCoords;          // GPS at interview start (hidden from UI)
  // Added fields
  respondent_email: string;
  respondent_phone: string;
  additional_contacts: AdditionalContact[];
}
