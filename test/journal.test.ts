import assert from "node:assert/strict";
import test from "node:test";
import {
  createCuratedJournalMatcher,
  normalizeJournalName,
} from "../src/index.ts";

const matchJournal = createCuratedJournalMatcher([
  {
    canonical: "British Journal of Dermatology",
    aliases: ["Br J Dermatol", "The British journal of dermatology"],
  },
  {
    canonical: "Journal of Investigative Dermatology",
    aliases: ["J Invest Dermatol"],
  },
]);

test("normalizes punctuation, casing, whitespace, and leading articles", () => {
  assert.equal(
    normalizeJournalName("  The British Journal of Dermatology  "),
    "british journal of dermatology",
  );
  assert.equal(
    normalizeJournalName("Journal of Dermatology & Venereology"),
    "journal of dermatology and venereology",
  );
});

test("matches only explicit canonical names and aliases", () => {
  assert.equal(
    matchJournal("Br J Dermatol")?.canonical,
    "British Journal of Dermatology",
  );
  assert.equal(
    matchJournal("J Invest Dermatol")?.canonical,
    "Journal of Investigative Dermatology",
  );
  assert.equal(matchJournal("New England Journal of Medicine"), undefined);
});

test("throws when two journals claim the same normalized alias", () => {
  assert.throws(
    () =>
      createCuratedJournalMatcher([
        { canonical: "Journal A", aliases: ["Shared Alias"] },
        { canonical: "Journal B", aliases: ["shared-alias"] },
      ]),
    /alias collision/i,
  );
});
