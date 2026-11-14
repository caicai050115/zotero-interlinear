import assert from "node:assert/strict";
import test from "node:test";

import { parseVocabulary, renderAnkiCsv, upsertVocabulary } from "../src/vocabulary.ts";

test("upsert updates the same word on the same item and csv stays Anki-importable", () => {
  const first = upsertVocabulary([], {
    word: "attention",
    context: "Attention is all you need.",
    explanation: "注意力机制",
    source: "Vaswani (2017) Attention",
    itemKey: "ITEM",
    id: "v1",
    createdAt: "2026-01-01T00:00:00.000Z",
  }, "2026-01-01T00:00:00.000Z");
  const second = upsertVocabulary(first.entries, {
    word: "Attention",
    context: "Updated context.",
    explanation: "更新后的解释",
    source: "Vaswani (2017) Attention",
    itemKey: "ITEM",
  }, "2026-02-01T00:00:00.000Z");

  assert.equal(second.entries.length, 1);
  assert.equal(second.entry.id, "v1");
  assert.equal(second.entry.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second.entry.explanation, "更新后的解释");

  const other = upsertVocabulary(second.entries, {
    word: "attention",
    context: "Other paper",
    explanation: "另一篇",
    source: "Other",
    itemKey: "OTHER",
    id: "v2",
  });
  assert.equal(other.entries.length, 2);

  const csv = renderAnkiCsv(other.entries);
  assert.match(csv, /^#separator:Comma\n#html:false\n#columns:Word,Context,Explanation,Source,ItemKey,Created\n/u);
  assert.match(csv, /Attention,Updated context\.,更新后的解释/u);
  const roundTrip = parseVocabulary(JSON.stringify(other.entries));
  assert.equal(roundTrip.length, 2);
  assert.equal(roundTrip[0].word, "Attention");
});

test("csv quotes commas, quotes, and newlines", () => {
  const csv = renderAnkiCsv([
    {
      id: "v",
      word: 'say "hi"',
      context: "a, b\nc",
      explanation: "plain",
      source: "src",
      itemKey: "k",
      createdAt: "t",
      updatedAt: "t",
    },
  ]);
  assert.match(csv, /"say ""hi""","a, b\nc",plain,src,k,t/u);
});
