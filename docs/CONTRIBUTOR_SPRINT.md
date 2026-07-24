# External contributor sprint

The collaboration target for this project is three independently reviewed contributions from people other than the maintainer. This document defines three small tracks that can be completed without clinical credentials or access to private infrastructure.

## Contribution rules

- Start from an issue labeled `good first issue` or `help wanted`.
- Keep each pull request focused on one observable contract.
- Add or update a deterministic fixture.
- Run `npm run validate` before opening the pull request.
- Do not add clinical recommendations, patient data, secrets, or claims of clinical validation.
- The maintainer will review evidence, boundary changes, and failure behavior rather than rewarding line count.

## Track 1: Source normalization

Good first contributions:

- punctuation and Unicode edge cases
- explicit journal aliases with negative controls
- collision fixtures
- property-oriented normalization invariants

A successful pull request should show the input, expected canonical result, and at least one nearby input that must remain rejected.

## Track 2: Language policy fixtures

Good first contributions:

- domain-specific certainty rules
- false-positive regressions
- source-boundary disclosure examples
- deterministic policy documentation

A successful pull request must explain why the rule belongs in a named policy and include both positive and negative fixtures. Regex breadth without negative controls will not be merged.

## Track 3: Gateway adapters and resilience

Good first contributions:

- Redis client adapter examples
- OpenTelemetry adapter examples
- additional fault-matrix cases
- load-harness reporting improvements
- route-key and header-boundary fixtures

A successful pull request must preserve tenant isolation, avoid logging credentials or bodies, and demonstrate fail-closed behavior when a dependency is unavailable.

## Review ladder

1. **Fixture contribution:** one focused regression and documentation update.
2. **Boundary contribution:** a small API or policy change with compatibility notes.
3. **Maintainer-ready contribution:** cross-file change with threat-model or release implications and complete review evidence.

Authorship is recorded through Git history. This repository will not add placeholder contributor names or count automated accounts as external contributors.

## Definition of done for the sprint

The sprint is complete only when three distinct external contributors have merged pull requests. Creating issues, adding templates, or merging maintainer-authored work does not satisfy that target.
