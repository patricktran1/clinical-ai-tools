# Governance

Clinical Evidence Guardrails is maintained as a small, safety-conscious open-source project. Governance is intentionally lightweight, but changes to evidence boundaries, tenant isolation, and release behavior require explicit review.

## Roles

### Maintainer

The maintainer is responsible for:

- issue triage and contributor support
- compatibility and release decisions
- review of evidence, security, and gateway-boundary changes
- vulnerability response
- npm publication and provenance verification

### Contributors

Contributors may propose fixes, fixtures, documentation, adapters, and API changes through pull requests. Authorship and review history remain visible in Git.

Repeated, high-quality contributions may lead to expanded triage or review responsibilities. No role is granted solely from commit count.

## Decision model

Routine fixes are accepted through reviewed pull requests when the required checks pass.

The following changes require an explicit maintainer rationale in the pull request:

- widening a journal or source allowlist
- changing certainty-policy defaults
- weakening exact-quote or source-boundary checks
- changing tenant identity, header, or rate-limit behavior
- changing deterministic gateway error contracts
- adding runtime dependencies
- making a breaking public API change
- publishing a new package version

## Review evidence

A pull request should include the smallest evidence set that proves its contract:

- deterministic positive and negative fixtures
- the relevant local command output
- compatibility notes for public API changes
- threat-boundary notes for gateway or credential-handling changes
- documentation updates when observable behavior changes

Green CI is necessary but not sufficient for merging a widened clinical or security boundary.

## Releases

Releases are tag-driven and must:

1. match the version in `package.json`
2. pass the complete validation suite
3. pass package-consumer smoke validation
4. pass operational load and fault checks
5. publish with npm provenance

The release workflow does not bypass npm account controls or environment approval.

## Security

Potential vulnerabilities should follow `SECURITY.md`, not public issue discussion. Security fixes may be developed privately and released before full technical detail is disclosed.

## Conduct

Participation is governed by `CODE_OF_CONDUCT.md`. Technical disagreement should focus on observable contracts, evidence, and tradeoffs rather than credentials or status.
