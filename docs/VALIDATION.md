# Validation contract

Every change to deterministic guardrail behavior should satisfy four gates:

1. TypeScript strict-mode validation
2. adversarial regression tests
3. native coverage collection
4. distributable package build

The CI workflow runs all four from a clean Node.js 22 environment. A passing workflow confirms technical consistency only; it does not establish clinical validity or authorize deployment.
