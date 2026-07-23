# Contributing

Thank you for helping improve Clinical Evidence Guardrails.

This project favors small, reviewable changes with explicit safety boundaries. A contribution should make deterministic clinical-evidence workflows easier to inspect, test, deploy, or adopt without implying that software validation replaces clinician judgment.

## Start here

1. Choose an open issue, preferably one labeled `good first issue` or `help wanted`.
2. Comment on the issue before beginning substantial work.
3. Create a focused branch from `main`.
4. Add or update tests for every behavior change.
5. Open a pull request using the repository template.

Good first contributions are deliberately bounded. An issue should state the desired outcome, relevant files, negative controls, and acceptance criteria. Ask on the issue when a boundary is unclear rather than expanding the scope silently.

## Local validation

Requires Node.js 22 or later.

```bash
npm install
npm run validate
npm run test:coverage
```

`npm run validate` now includes a clean package-consumer smoke test. It builds and packs the tarball, installs it into a temporary project, and imports through the public package name. This catches missing declarations, incorrect exports, and files that work only through repository-relative paths.

Run the package test independently with:

```bash
npm run test:package
```

## Contribution paths

### Evidence validation

Good changes include source normalization, exact quote handling, claim mapping, certainty policies, and source-boundary disclosure fixtures.

### Gateway infrastructure

Good changes include Redis adapter examples, trace propagation fixtures, deterministic error behavior, load-test scaffolding, fault injection, and framework integrations that preserve tenant and credential boundaries.

### Examples and adoption

Examples should import only from `@patricktran1/clinical-evidence-guardrails`, use synthetic data, and remain copyable without hidden repository state. The [`examples`](examples) directory contains the preferred format.

### Documentation and contributor experience

Small improvements to terminology, setup steps, failure messages, and issue boundaries are welcome when they reduce ambiguity for the next contributor.

## Contribution standards

### Keep the core deterministic

Do not add an LLM dependency to validation, gateway-control, rate-limit, trace, or telemetry functions. Model adapters may be proposed separately, but safety-critical checks must remain deterministic and independently testable.

### Fail closed

When evidence is missing, malformed, fabricated, outside the configured boundary, or a required gateway dependency is unavailable, the library should reject or stop rather than infer support or bypass a control.

### Preserve explicit allowlists and tenant boundaries

Source normalization may handle formatting differences, but it must not silently broaden a curated journal or source list. New abbreviations and aliases require fixtures and rationale.

Tenant identity must come from a trusted resolver. Callers must not be able to select tenants or overwrite authoritative forwarding headers through request headers.

### Add adversarial tests

Happy-path tests are not enough. Include relevant negative controls such as:

- fabricated quotations
- partially matching claims
- alias collisions
- empty evidence maps
- unsafe certainty language
- missing source-boundary disclosures
- duplicate or cross-tenant rate-limit keys
- malformed Redis responses
- spoofed forwarding and trace headers
- dependency outages and timeouts
- repeated telemetry closure

### Test the public package surface

Tests should normally import from `../dist/index.js`, not private source modules. Consumer-facing changes must also pass the packed-package smoke test.

### Avoid clinical overclaiming

Documentation and examples must not present the library as a medical device, diagnostic system, treatment recommender, autonomous publishing authority, or substitute for clinician judgment.

## Pull request checklist

- [ ] The change is scoped and documented.
- [ ] Tests cover success and failure modes.
- [ ] `npm run validate` passes.
- [ ] Public exports and packed-package behavior remain correct.
- [ ] Safety, tenant, and source-boundary implications are explained.
- [ ] No credentials, patient data, or proprietary source text are included.

## Reporting security issues

Do not open public issues for vulnerabilities involving authorization bypasses, tenant isolation, source-validation bypasses, unsafe publication pathways, credential exposure, or patient-data handling. Follow `SECURITY.md` instead.
