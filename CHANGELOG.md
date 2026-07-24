# Changelog

All notable changes to Clinical Evidence Guardrails will be documented here.

The project follows semantic versioning.

## [Unreleased]

### Added

- named, validated certainty policies with deterministic rule ordering
- literature-review and clinical-education policy presets
- policy and rule metadata on every certainty rejection
- caller-selectable certainty policies in evidence-card validation
- regression coverage for overlapping rules, empty policies, duplicate labels, and stateful regexes
- multi-tenant Fetch API gateway with explicit tenant resolution and route isolation
- process-local token bucket for development and single-node deployments
- atomic Redis token bucket adapter without a runtime Redis dependency
- W3C traceparent validation and child-span propagation
- OpenTelemetry-compatible tracer and metrics adapter interfaces
- deterministic gateway errors, request-size limits, upstream timeouts, and rate-limit metadata
- adversarial tests for tenant isolation, header spoofing, dependency outages, Redis responses, trace context, timeouts, and telemetry closure
- 480-request, twelve-tenant isolation load harness
- executable fail-closed gateway fault matrix
- runnable Node HTTP-to-Fetch reference gateway
- production-shaped gateway service with validated tenant configuration
- separate liveness and readiness endpoints
- visible drain behavior and bounded graceful shutdown
- non-root multi-stage container image with liveness health check
- machine-readable OpenAPI 3.1 gateway contract
- OpenAPI drift tests for authentication, errors, and correlation headers
- container build and runtime smoke test in CI
- CycloneDX software bill of materials retained with CI evidence
- clean packed-package consumer smoke test using the public package name
- zero-dependency `clinical-evidence-check` command-line interface
- installed-binary consumer validation through `node_modules/.bin`
- copyable evidence-validation and Fetch gateway integration examples
- contributor-ready issue and pull request templates
- three-track external contributor sprint and first-time contributor onboarding
- provenance-enabled tagged npm release workflow
- reproducible npm lockfile generated and verified on Node 22
- enforceable source coverage floors for lines, functions, and branches
- official pull-request dependency review with a deterministic lockfile-policy fallback
- moderate-or-higher dependency audit policy for pull-request changes
- registry, SHA-512 integrity, and license allowlist checks for new or changed packages
- OpenSSF Scorecard analysis with OIDC publication, retained SARIF, and code-scanning upload
- CodeQL and dependency maintenance automation

### Changed

- custom source-boundary regexes are reset before and after validation so global and sticky patterns remain repeatable
- package positioning now includes bounded evidence-service infrastructure in addition to evidence-artifact validation
- contributor validation now checks the installable tarball as well as repository tests
- the complete operational gate now exercises load, faults, reference service, production-shaped service, and OpenAPI contracts
- CI now uses `npm ci` and retains coverage, audits, operational reports, container metadata, and an SBOM
- dependency review retains both GitHub API output and deterministic fallback evidence as workflow artifacts

### Safety boundary

- certainty policies are intentionally incomplete deterministic screens and do not replace clinical, editorial, or domain review
- the gateway does not provide secret management, user authorization, PHI redaction, network isolation, or autonomous clinical validation
- the reference service uses process-local rate limiting unless a deployment composes a shared store
- health and readiness checks establish process and traffic state, not clinical validity or production SLO compliance
- coverage and supply-chain policy improve regression visibility but do not prove complete correctness or eliminate dependency risk
- examples and consumer fixtures use synthetic content and do not establish clinical sufficiency

## [0.1.0] - 2026-07-23

### Added

- dependency-free TypeScript package structure
- curated journal normalization and explicit alias matching
- exact source-quote verification
- deterministic claim comparison
- unsupported-certainty screening
- evidence-card validation with structured issue codes
- adversarial regression tests and native coverage reporting
- CI, documentation, contribution guidance, and security policy

### Safety boundary

- the package does not diagnose, recommend treatment, approve publication, or replace clinician review
