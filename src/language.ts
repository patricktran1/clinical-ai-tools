export interface CertaintyRule {
  readonly label: string;
  readonly pattern: RegExp;
}

export interface CertaintyPolicy {
  readonly name: string;
  readonly rules: readonly CertaintyRule[];
}

export interface UnsafeCertaintyMatch {
  /** Backward-compatible alias for `rule`. */
  readonly phrase: string;
  readonly rule: string;
  readonly policy: string;
  readonly text: string;
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase("en-US");
}

function cloneStatelessPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return new RegExp(pattern.source, flags);
}

/**
 * Build a named, deterministic certainty policy.
 *
 * Duplicate labels are rejected case-insensitively so downstream audit logs
 * always identify one unambiguous rule. Stateful `g` and `y` flags are removed
 * to keep repeated validation calls deterministic.
 */
export function createCertaintyPolicy(
  name: string,
  rules: readonly CertaintyRule[],
): CertaintyPolicy {
  const policyName = name.trim();
  if (!policyName) {
    throw new Error("Certainty policy name must not be empty.");
  }

  const labels = new Set<string>();
  const normalizedRules = rules.map((rule) => {
    const label = rule.label.trim();
    if (!label) {
      throw new Error("Certainty rule labels must not be empty.");
    }

    const normalizedLabel = normalizeLabel(label);
    if (labels.has(normalizedLabel)) {
      throw new Error(`Duplicate certainty rule label: ${label}`);
    }
    labels.add(normalizedLabel);

    return Object.freeze({
      label,
      pattern: cloneStatelessPattern(rule.pattern),
    });
  });

  return Object.freeze({
    name: policyName,
    rules: Object.freeze(normalizedRules),
  });
}

const DEFAULT_RULES = [
  { label: "proves", pattern: /\bproves?\b/i },
  { label: "guarantees", pattern: /\bguarantees?\b/i },
  { label: "cures", pattern: /\bcures?\b/i },
  { label: "for all patients", pattern: /\bfor all patients\b/i },
  { label: "replace existing care", pattern: /\bshould\s+(?:immediately\s+)?replace\b/i },
  { label: "practice-changing", pattern: /\bpractice[- ]changing\b/i },
  { label: "always", pattern: /\balways\b/i },
  { label: "never", pattern: /\bnever\b/i },
  { label: "zero risk", pattern: /\bzero risk\b/i },
] as const satisfies readonly CertaintyRule[];

export const DEFAULT_CERTAINTY_POLICY = createCertaintyPolicy(
  "default",
  DEFAULT_RULES,
);

export const LITERATURE_REVIEW_CERTAINTY_POLICY = createCertaintyPolicy(
  "literature-review",
  [
    ...DEFAULT_RULES,
    { label: "definitive evidence", pattern: /\bdefinitive evidence\b/i },
    { label: "establishes causation", pattern: /\bestablish(?:es|ed)?\s+caus(?:ation|ality)\b/i },
    { label: "conclusive", pattern: /\bconclusive(?:ly)?\b/i },
  ],
);

export const CLINICAL_EDUCATION_CERTAINTY_POLICY = createCertaintyPolicy(
  "clinical-education",
  [
    ...DEFAULT_RULES,
    { label: "safe for everyone", pattern: /\bsafe\s+for\s+everyone\b/i },
    { label: "must use", pattern: /\bmust\s+(?:use|prescribe|recommend)\b/i },
    { label: "now standard of care", pattern: /\bnow\s+(?:the\s+)?standard\s+of\s+care\b/i },
  ],
);

/**
 * Detect language that overstates what bounded evidence can support.
 *
 * The default policy preserves the original API behavior. Passing a custom
 * policy allows domain-specific screening while remaining deterministic.
 * This is not a complete language-safety system or a substitute for review.
 */
export function findUnsafeCertainty(
  texts: readonly string[],
  policy: CertaintyPolicy = DEFAULT_CERTAINTY_POLICY,
): UnsafeCertaintyMatch[] {
  const matches: UnsafeCertaintyMatch[] = [];

  for (const text of texts) {
    for (const rule of policy.rules) {
      if (rule.pattern.test(text)) {
        matches.push({
          phrase: rule.label,
          rule: rule.label,
          policy: policy.name,
          text,
        });
      }
    }
  }

  return matches;
}
