# Design notes

Clinical Evidence Guardrails separates model generation from deterministic acceptance checks.

## Trust boundary

The library accepts plain source text and a structured evidence artifact. It returns a validation result with explicit component outcomes and issue codes. It does not call a model, fetch evidence, score clinical quality, or authorize publication.

## Why deterministic primitives

- identical inputs produce identical outputs
- failure modes can be represented as fixtures
- source and language policies can be reviewed in code
- applications retain an independent veto layer when model behavior changes

## Intended integration

```text
source retrieval
  -> model-generated draft
  -> Clinical Evidence Guardrails
  -> application-specific clinical review
  -> explicit human authorization
```

A passing result is an input to review, never proof that a claim is clinically correct or ready for release.
