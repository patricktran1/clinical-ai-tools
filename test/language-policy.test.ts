import assert from "node:assert/strict";
import test from "node:test";
import {
  CLINICAL_EDUCATION_CERTAINTY_POLICY,
  DEFAULT_CERTAINTY_POLICY,
  LITERATURE_REVIEW_CERTAINTY_POLICY,
  createCertaintyPolicy,
  findUnsafeCertainty,
} from "../dist/index.js";

test("preserves default screening behavior and adds audit metadata", () => {
  const [match] = findUnsafeCertainty(["This result proves the treatment always works."]);

  assert.equal(match?.phrase, "proves");
  assert.equal(match?.rule, "proves");
  assert.equal(match?.policy, DEFAULT_CERTAINTY_POLICY.name);
  assert.equal(match?.text, "This result proves the treatment always works.");
});

test("returns every overlapping rule in deterministic order", () => {
  const policy = createCertaintyPolicy("overlap-test", [
    { label: "must", pattern: /\bmust\b/gi },
    { label: "must never", pattern: /\bmust never\b/iy },
  ]);

  const first = findUnsafeCertainty(["Clinicians must never skip review."], policy);
  const second = findUnsafeCertainty(["Clinicians must never skip review."], policy);

  assert.deepEqual(
    first.map((match) => match.rule),
    ["must", "must never"],
  );
  assert.deepEqual(second, first);
  assert.ok(first.every((match) => match.policy === "overlap-test"));
});

test("allows an intentionally empty policy", () => {
  const policy = createCertaintyPolicy("record-only", []);

  assert.deepEqual(
    findUnsafeCertainty(["This proves the treatment always works."], policy),
    [],
  );
});

test("rejects duplicate labels case-insensitively", () => {
  assert.throws(
    () =>
      createCertaintyPolicy("invalid", [
        { label: "Definitive evidence", pattern: /definitive/i },
        { label: " definitive EVIDENCE ", pattern: /conclusive/i },
      ]),
    /duplicate certainty rule label/i,
  );
});

test("literature review preset flags causal and definitive overclaims", () => {
  const matches = findUnsafeCertainty(
    ["This provides definitive evidence and establishes causation."],
    LITERATURE_REVIEW_CERTAINTY_POLICY,
  );

  assert.deepEqual(
    matches.map((match) => match.rule),
    ["definitive evidence", "establishes causation"],
  );
});

test("clinical education preset flags universal safety and directives", () => {
  const matches = findUnsafeCertainty(
    ["This treatment is safe for everyone and must be prescribed."],
    CLINICAL_EDUCATION_CERTAINTY_POLICY,
  );

  assert.deepEqual(
    matches.map((match) => match.rule),
    ["safe for everyone", "must use"],
  );
});
