import { z } from "zod";

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const CATEGORIES = ["electrical", "plumbing", "networking", "equipment", "structural", "cleaning", "other"] as const;
export const STATUSES = ["new", "triaged", "in_progress", "resolved"] as const;
export const TEAMS = [
  "Electrical Services",
  "Plumbing",
  "IT & Network",
  "Facilities & Equipment",
  "Structural & Grounds",
  "Custodial",
  "General Maintenance",
] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];
export type Team = (typeof TEAMS)[number];
export type Role = "reporter" | "staff";

export const DEFAULT_TEAM: Record<Category, Team> = {
  electrical: "Electrical Services",
  plumbing: "Plumbing",
  networking: "IT & Network",
  equipment: "Facilities & Equipment",
  structural: "Structural & Grounds",
  cleaning: "Custodial",
  other: "General Maintenance",
};

export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Target time to resolve once a human approves the priority. */
export const SLA_HOURS: Record<Priority, number> = { critical: 4, high: 24, medium: 72, low: 168 };
/** Target time for a human to triage a brand-new report. */
export const TRIAGE_SLA_HOURS = 24;

export const LABELS = {
  status: { new: "Awaiting triage", triaged: "Triaged", in_progress: "In progress", resolved: "Resolved" } as Record<Status, string>,
  category: {
    electrical: "Electrical",
    plumbing: "Plumbing",
    networking: "Networking",
    equipment: "Equipment",
    structural: "Structural",
    cleaning: "Cleaning",
    other: "Other",
  } as Record<Category, string>,
};

// ---------- Records ----------

export interface Issue {
  id: string;
  title: string;
  description: string;
  building: string;
  location: string;
  category: Category | null; // reporter hint until triaged, then human-approved
  reporterId: string;
  reporterName: string;
  priority: Priority | null; // human-approved only
  status: Status;
  assignedTeam: Team | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  photoRef: string | null; // demo: data URL, Supabase: storage path
  resolutionPhotoRef: string | null;
  isSample?: boolean;
}

export type AssessmentStatus = "pending" | "succeeded" | "failed";

export interface SafetyResult {
  applied: boolean;
  matchedRules: { id: string; label: string; minPriority: Priority; matched: string }[];
  explanation: string | null;
  finalRecommendation: GemmaDecision | null; // post-rule recommendation; null if the model failed
}

export interface Assessment {
  id: string;
  issueId: string;
  modelName: string;
  promptVersion: string;
  status: AssessmentStatus;
  modelRecommendation: GemmaDecision | null; // the model's output exactly as validated
  safetyOverride: SafetyResult | null;
  error: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  issueId: string;
  actorId: string;
  actorName: string;
  actionType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Viewer {
  id: string;
  name: string;
  role: Role;
}

// ---------- Gemma decision schema ----------

export const gemmaDecisionSchema = z
  .object({
    priority: z.enum(PRIORITIES),
    category: z.enum(CATEGORIES),
    responsibleTeam: z.enum(TEAMS),
    summary: z.string().trim().min(5).max(400),
    rationale: z.string().trim().min(10).max(1500),
    safetyFlags: z.array(z.string().trim().min(1).max(80)).max(10),
    immediateActions: z.array(z.string().trim().min(3).max(300)).min(1).max(8),
    needsHumanReview: z.boolean(),
    missingInformation: z.array(z.string().trim().min(3).max(300)).max(8),
    escalationRecommended: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type GemmaDecision = z.infer<typeof gemmaDecisionSchema>;

// ---------- Request schemas ----------

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const newIssueSchema = z.object({
  title: text(5, 120, "Title"),
  description: text(15, 4000, "Description"),
  building: text(2, 80, "Building"),
  location: text(1, 120, "Location"),
  category: z.enum(CATEGORIES).nullable().optional(),
  reporterName: z.string().trim().max(80).optional(),
  clientRequestId: z.uuid(),
});
export type NewIssueInput = z.infer<typeof newIssueSchema>;

export const triageRequestSchema = z.object({ issueId: z.string().min(1).max(64) });

const reason = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000);

export const patchIssueSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide"),
    mode: z.enum(["accept", "override", "manual"]),
    assessmentId: z.string().optional(),
    priority: z.enum(PRIORITIES),
    category: z.enum(CATEGORIES),
    team: z.enum(TEAMS),
    assignedTo: z.string().trim().max(80).optional(),
    reason: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("assign"),
    team: z.enum(TEAMS),
    assignedTo: z.string().trim().max(80).optional(),
  }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("resolve"), resolutionNotes: text(10, 4000, "Resolution description") }),
  z.object({ action: z.literal("reopen"), reason }),
]);
export type PatchIssueInput = z.infer<typeof patchIssueSchema>;

export const noteSchema = z.object({ note: text(2, 2000, "Note") });

// ---------- Attachments ----------

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImage(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Photo must be a JPEG, PNG, or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return "Photo must be 5 MB or smaller.";
  if (file.size === 0) return "Photo file is empty.";
  return null;
}
