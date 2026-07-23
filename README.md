# Clinical Evidence Guardrails

[![CI](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml)
[![CodeQL](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Deterministic TypeScript guardrails for source-grounded clinical evidence workflows.**

Clinical Evidence Guardrails is a small, dependency-free library for teams building evidence summarization, clinical education, literature triage, and human-reviewed AI workflows. It provides reusable checks that remain outside the model:

- explicitly curated source matching
- exact source-quote verification
- claim-to-evidence mapping
- unsupported-certainty detection
- source-boundary disclosure checks

The library does not determine clinical truth, recommend treatment, or authorize publication. It helps applications fail closed when generated evidence artifacts are ungrounded or overstated.

## Why this exists

LLMs can produce useful drafts while still inventing quotations, widening a source allowlist, overstating certainty, or presenting an abstract-only review as though full text were processed. Those are system-design problems, not prompt-writing problems.

This package makes several high-value checks deterministic, inspectable, and testable.

## Install

```bash
npm install @patricktran1/clinical-evidence-guardrails
```

The package is currently source-ready and prepared for its first npm publication. Until then, clone the repository and run the examples locally.

## Quick start

```ts
import {
  createCuratedJournalMatcher,
  validateEvidenceCard,
} from "@patricktran1/clinical-evidence-guardrails";

const matchJournal = createCuratedJournalMatcher([
  {
    canonical: "British Journal of Dermatology",
    aliases: ["Br J Dermatol", "The British journal of dermatology"],
  },
]);

const journal = matchJournal("Br J Dermatol");
// { canonical: "British Journal of Dermatology", matchedAlias: "Br J Dermatol" }

const sourceQuote =
  "At week 16, 62% of participants achieved the primary endpoint compared with 31% receiving placebo.";

const result = validateEvidenceCard(
  {
    correctAnswer: sourceQuote,
    limitations:
      "Only the PubMed abstract was processed; full-text review remains required.",
    assertedText: [
      "The reported endpoint may inform review of the studied population.",
    ],
    evidenceMap: [
      {
        claim: sourceQuote,
        sourceQuote,
        supportType: "direct",
      },
    ],
  },
  `RESULTS: ${sourceQuote}`,
);

if (!result.passed) {
  console.error(result.issues);
}
```

## API

### `createCuratedJournalMatcher(journals)`

Builds a deterministic matcher from canonical journal names and explicit aliases. Normalization handles casing, punctuation, ampersands, whitespace, and a leading `The`. Abbreviations still require explicit aliases, and alias collisions throw during construction.

### `quoteAppearsInSource(source, quote)`

Confirms that a non-empty source quote appears in the supplied source after Unicode and whitespace normalization. It does not use semantic similarity.

### `findUnsafeCertainty(texts)`

Flags phrases such as `proves`, `guarantees`, `cures`, `for all patients`, `practice-changing`, and universal language. This is a deterministic screening layer, not a complete clinical-language policy.

### `validateEvidenceCard(card, source, options?)`

Returns:

```ts
{
  passed: boolean;
  exactQuotes: boolean;
  correctAnswerMapped: boolean;
  languageSafe: boolean;
  sourceBoundaryExplicit: boolean;
  unsafeMatches: UnsafeCertaintyMatch[];
  issues: GuardrailIssue[];
}
```

A card passes only when:

1. at least one evidence mapping exists
2. every quoted excerpt appears in the source
3. the correct answer is represented by a grounded claim
4. asserted language avoids configured high-certainty patterns
5. limitations explicitly disclose the processed source boundary

## Design principles

- **Fail closed.** Missing or fabricated evidence blocks acceptance.
- **Keep models bounded.** Deterministic code retains veto authority.
- **Make source scope visible.** Abstract-only processing must be disclosed.
- **Prefer explicit allowlists.** Normalization never silently broadens eligibility.
- **Separate validation from authorization.** Passing guardrails does not equal physician approval or publication.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm test
npm run test:coverage
npm run check
npm run build
```

`npm run validate` runs the complete local gate.

## Repository map

```text
src/journal.ts     curated-source normalization and matching
src/text.ts        exact-quote and claim comparison helpers
src/language.ts    unsupported-certainty screening
src/evidence.ts    evidence-card validation
src/index.ts       public package exports
test/              deterministic regression suites
```

## Contributing

Focused contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and an issue labeled `good first issue` or `help wanted`.

High-value contribution areas include:

- additional clinical-language policies with fixtures
- source-format normalization edge cases
- configurable boundary disclosures
- property-based tests
- examples for literature-review and clinical-education workflows

## Safety and scope

This is research and developer infrastructure. It is not a medical device, diagnostic system, clinical recommendation engine, or substitute for clinician judgment. Do not use it to make autonomous patient-care or publication decisions.

See [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## License

MIT © Patrick Tran
