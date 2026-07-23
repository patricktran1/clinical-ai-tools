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
- contributor-ready issue and pull request templates
- CodeQL and dependency maintenance automation

### Changed

- custom source-boundary regexes are reset before and after validation so global and sticky patterns remain repeatable
- package positioning now includes bounded evidence-service infrastructure in addition to evidence-artifact validation

### Safety boundary

- certainty policies are intentionally incomplete deterministic screens and do not replace clinical, editorial, or domain review
- the gateway does not provide secret management, user authorization, PHI redaction, network isolation, or autonomous clinical validation

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
