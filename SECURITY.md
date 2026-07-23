# Security Policy

## Supported versions

Security fixes are applied to the latest release and the current `main` branch.

## Reporting a vulnerability

Please report vulnerabilities privately to `patrick@trandermatology.com` with:

- affected function or workflow
- reproduction steps
- expected and observed behavior
- potential impact
- suggested mitigation, if available

Do not include real patient data, credentials, private clinical records, or proprietary source text.

## High-priority reports

Reports receive priority when they involve:

- fabricated source quotes passing validation
- incorrect claim-to-evidence mappings passing validation
- source allowlist bypasses
- unsafe certainty escaping configured screening
- source-boundary disclosures being incorrectly accepted
- package supply-chain compromise
- credential or sensitive-data exposure

## Scope

This package is deterministic developer infrastructure. It does not provide authentication, patient-data storage, clinical diagnosis, treatment recommendations, physician approval, or publication authorization.

Passing a guardrail result means only that the configured deterministic checks passed. It must not be treated as clinical validation or autonomous release approval.
