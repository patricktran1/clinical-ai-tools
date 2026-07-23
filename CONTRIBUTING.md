# Contributing

Thank you for helping improve Clinical Evidence Guardrails.

This project favors small, reviewable changes with explicit safety boundaries. A contribution should make deterministic clinical-evidence workflows easier to inspect, test, or adopt without implying that software validation replaces clinician judgment.

## Start here

1. Choose an open issue, preferably one labeled `good first issue` or `help wanted`.
2. Comment on the issue before beginning substantial work.
3. Create a focused branch.
4. Add or update tests for every behavior change.
5. Open a pull request using the repository template.

## Local validation

Requires Node.js 22 or later.

```bash
npm install
npm run validate
npm run test:coverage
```

## Contribution standards

### Keep the core deterministic

Do not add an LLM dependency to the validation functions. Model adapters may be proposed separately, but source matching, quote grounding, language screening, and evidence-card validation must remain deterministic and independently testable.

### Fail closed

When evidence is missing, malformed, fabricated, or outside the configured boundary, validation should reject the artifact rather than infer support.

### Preserve explicit allowlists

Source normalization may handle formatting differences, but it must not silently broaden a curated journal or source list. New abbreviations and aliases require fixtures and rationale.

### Add adversarial tests

Happy-path tests are not enough. Include relevant negative controls such as:

- fabricated quotations
- partially matching claims
- alias collisions
- empty evidence maps
- unsafe certainty language
- missing source-boundary disclosures

### Avoid clinical overclaiming

Documentation and examples must not present the library as a medical device, diagnostic system, treatment recommender, or autonomous publishing authority.

## Pull request checklist

- [ ] The change is scoped and documented.
- [ ] Tests cover success and failure modes.
- [ ] `npm run validate` passes.
- [ ] Safety and source-boundary implications are explained.
- [ ] No credentials, patient data, or proprietary source text are included.

## Reporting security issues

Do not open public issues for vulnerabilities involving authorization bypasses, source-validation bypasses, unsafe publication pathways, credential exposure, or patient-data handling. Follow `SECURITY.md` instead.
