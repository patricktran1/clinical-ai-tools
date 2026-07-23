export interface CuratedJournal {
  canonical: string;
  aliases?: readonly string[];
}

export interface JournalMatch {
  canonical: string;
  matchedAlias: string;
}

/**
 * Normalize journal names without widening an allowlist.
 *
 * The normalization is intentionally conservative: Unicode compatibility,
 * casing, punctuation, ampersands, whitespace, and a leading article are
 * normalized, but abbreviations still require an explicit alias.
 */
export function normalizeJournalName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Build a deterministic matcher for an explicitly curated journal set.
 * Alias collisions throw during construction rather than silently routing a
 * source to the wrong journal.
 */
export function createCuratedJournalMatcher(journals: readonly CuratedJournal[]) {
  const aliases = new Map<string, JournalMatch>();

  for (const journal of journals) {
    const candidates = [journal.canonical, ...(journal.aliases ?? [])];

    for (const candidate of candidates) {
      const normalized = normalizeJournalName(candidate);
      const existing = aliases.get(normalized);

      if (existing && existing.canonical !== journal.canonical) {
        throw new Error(
          `Journal alias collision: ${candidate} maps to both ${existing.canonical} and ${journal.canonical}`,
        );
      }

      aliases.set(normalized, {
        canonical: journal.canonical,
        matchedAlias: candidate,
      });
    }
  }

  return (value: string): JournalMatch | undefined =>
    aliases.get(normalizeJournalName(value));
}
