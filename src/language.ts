const UNSAFE_CERTAINTY_PATTERNS = [
  { label: "proves", pattern: /\bproves?\b/i },
  { label: "guarantees", pattern: /\bguarantees?\b/i },
  { label: "cures", pattern: /\bcures?\b/i },
  { label: "for all patients", pattern: /\bfor all patients\b/i },
  { label: "replace existing care", pattern: /\bshould\s+(?:immediately\s+)?replace\b/i },
  { label: "practice-changing", pattern: /\bpractice[- ]changing\b/i },
  { label: "always", pattern: /\balways\b/i },
  { label: "never", pattern: /\bnever\b/i },
  { label: "zero risk", pattern: /\bzero risk\b/i },
] as const;

export interface UnsafeCertaintyMatch {
  phrase: string;
  text: string;
}

/**
 * Detect language that overstates what bounded evidence can support.
 * This is a deterministic screening layer, not a substitute for clinical review.
 */
export function findUnsafeCertainty(texts: readonly string[]): UnsafeCertaintyMatch[] {
  const matches: UnsafeCertaintyMatch[] = [];

  for (const text of texts) {
    for (const rule of UNSAFE_CERTAINTY_PATTERNS) {
      if (rule.pattern.test(text)) {
        matches.push({ phrase: rule.label, text });
      }
    }
  }

  return matches;
}
