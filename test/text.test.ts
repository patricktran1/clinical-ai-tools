import assert from "node:assert/strict";
import test from "node:test";
import {
  claimsMatch,
  normalizeWhitespace,
  quoteAppearsInSource,
} from "../src/index.ts";

test("normalizes Unicode-compatible whitespace without changing meaning", () => {
  assert.equal(normalizeWhitespace("  one\n\t two  "), "one two");
  assert.equal(claimsMatch("At week 16, 62% responded.", "At week 16,   62% responded."), true);
});

test("accepts a source quote only when it appears in the source", () => {
  const source = "RESULTS: At week 16, 62% of participants met the primary endpoint.";

  assert.equal(
    quoteAppearsInSource(
      source,
      "At week 16, 62% of participants met the primary endpoint.",
    ),
    true,
  );
  assert.equal(
    quoteAppearsInSource(source, "At week 16, 82% met the primary endpoint."),
    false,
  );
  assert.equal(quoteAppearsInSource(source, "   "), false);
});
