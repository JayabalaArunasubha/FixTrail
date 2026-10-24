import { PRIORITY_RANK, type GemmaDecision, type Priority, type SafetyResult } from "./domain";

/**
 * Deterministic hazard rules applied AFTER the model responds.
 * Pattern matching cannot guarantee every hazard is detected; it only guarantees
 * that these known patterns are never ranked below their minimum priority.
 */
export interface SafetyRule {
  id: string;
  label: string;
  minPriority: Priority;
  pattern: RegExp;
}

export const SAFETY_RULES: SafetyRule[] = [
  { id: "exposed_wiring", label: "Exposed or damaged wiring", minPriority: "critical", pattern: /\b(exposed|bare|frayed|hanging|loose|dangling)\s+(live\s+)?(wires?|wiring|cables?)\b|\bwires?\s+(are\s+)?(exposed|hanging|sparking)\b/i },
  { id: "electric_shock", label: "Electric shock reported", minPriority: "critical", pattern: /\b(electric(al)?\s+)?shock(ed)?\b|\belectrocut/i },
  { id: "sparks", label: "Sparking or arcing", minPriority: "critical", pattern: /\bspark(s|ing|ed)?\b|\barc(ing)?\b/i },
  { id: "fire_smoke", label: "Fire, smoke, or burning smell", minPriority: "critical", pattern: /\b(fire|flames?|smoke|smoking|burning\s+smell|smell(s|ed)?\s+(like\s+)?burning|scorch(ed)?)\b/i },
  { id: "gas_leak", label: "Possible gas leak", minPriority: "critical", pattern: /\bgas\s+(leak|smell|odou?r)\b|\bsmell(s|ed)?\s+(of|like)\s+gas\b|\brotten\s+eggs?\b/i },
  { id: "structural", label: "Structural danger", minPriority: "critical", pattern: /\b(collaps(e|ed|ing)|ceiling\s+(caving|fell|falling|sagging)|large\s+crack|cracked\s+(beam|wall|column)|falling\s+debris)\b/i },
  { id: "water_electrical", label: "Water near electrical equipment", minPriority: "critical", pattern: /\b(water|leak(ing|s)?|flood(ing|ed)?|wet|damp|moist|dripping)\b[^.]{0,80}\b(outlet|socket|panel|breaker|wiring|electrical|power\s+strip|server)\b|\b(outlet|socket|panel|breaker|wiring|electrical|power\s+strip|server)\b[^.]{0,80}\b(water|leak(ing|s)?|flood(ing|ed)?|wet|damp|moist|dripping)\b/i },
  { id: "carbon_monoxide", label: "Carbon monoxide alarm", minPriority: "critical", pattern: /\bcarbon\s+monoxide\b|\bCO\s+(alarm|detector)\b/i },
  { id: "trapped", label: "Person trapped (e.g. elevator)", minPriority: "critical", pattern: /\b(trapped|stuck)\s+(in|inside)\s+(the\s+)?(elevator|lift)\b/i },
  { id: "flooding", label: "Active flooding", minPriority: "high", pattern: /\bflood(ing|ed)?\b|\bburst\s+pipe\b/i },
];

export function matchSafetyRules(text: string) {
  return SAFETY_RULES.flatMap((rule) => {
    const m = text.match(rule.pattern);
    return m ? [{ id: rule.id, label: rule.label, minPriority: rule.minPriority, matched: m[0] }] : [];
  });
}

export const issueText = (i: { title: string; description: string; location: string }) => `${i.title}\n${i.description}\n${i.location}`;

/** Highest minimum priority among matched rules, or null. Works with or without a model response. */
export function safetyFloor(text: string): Priority | null {
  const matched = matchSafetyRules(text);
  if (!matched.length) return null;
  return matched.reduce<Priority>((best, r) => (PRIORITY_RANK[r.minPriority] < PRIORITY_RANK[best] ? r.minPriority : best), "low");
}

/** Apply hazard rules to a validated model decision. Never mutates the model output. */
export function applySafetyRules(reportText: string, decision: GemmaDecision): SafetyResult {
  const matchedRules = matchSafetyRules(reportText);
  if (matchedRules.length === 0) {
    return { applied: false, matchedRules, explanation: null, finalRecommendation: decision };
  }

  const floor = safetyFloor(reportText)!;
  const raised = PRIORITY_RANK[floor] < PRIORITY_RANK[decision.priority];
  const flags = Array.from(new Set([...decision.safetyFlags, ...matchedRules.map((r) => r.id)]));
  const final: GemmaDecision = {
    ...decision,
    priority: raised ? floor : decision.priority,
    safetyFlags: flags,
    needsHumanReview: true, // known hazard patterns always need a person to confirm
    escalationRecommended: decision.escalationRecommended || floor === "critical",
  };

  const labels = matchedRules.map((r) => `${r.label} (“${r.matched}”)`).join("; ");
  const explanation = raised
    ? `Safety rule raised priority from ${decision.priority} to ${floor}. Matched: ${labels}. Known hazards cannot be ranked below their minimum priority.`
    : `Safety rules matched (${labels}). Model priority already met the minimum; human review is required.`;

  return { applied: raised, matchedRules, explanation, finalRecommendation: final };
}
