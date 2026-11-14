import assert from "node:assert/strict";
import test from "node:test";

import {
  createStoredRecord,
  parseStoredRecord,
  recordKey,
  renderNoteHtml,
} from "../src/snippetRecord.ts";

test("note html round-trips a snippet, including updated annotation key", () => {
  const record = createStoredRecord(
    {
      kind: "snippet",
      source: "Attention is all you need.",
      body: "注意力就是你所需要的一切。",
      pageLabel: "3",
      pageIndex: 2,
      attachmentKey: "PDFKEY",
      annotationKey: "ANNKEY",
      question: "",
      title: "",
    },
    "2026-11-14T00:00:00.000Z",
  );
  const parsed = parseStoredRecord(renderNoteHtml(record));
  assert.equal(parsed?.key, record.key);
  assert.equal(parsed?.source, "Attention is all you need.");
  assert.equal(parsed?.body, "注意力就是你所需要的一切。");
  assert.equal(parsed?.pageLabel, "3");
  assert.equal(parsed?.pageIndex, 2);
  assert.equal(parsed?.annotationKey, "ANNKEY");
  assert.equal(parsed?.kind, "snippet");
});

test("the same source text keeps a stable key so re-save can update", () => {
  const left = recordKey("snippet", "Attention   is\nall you need.");
  const right = recordKey("snippet", "Attention is all you need.");
  assert.equal(left, right);
  assert.notEqual(left, recordKey("explanation", "Attention is all you need."));
});

test("html in the source is escaped and still parses", () => {
  const record = createStoredRecord({
    kind: "explanation",
    source: `Use <b> & "quotes"`,
    body: "解释",
    title: "Explain word: Use",
    question: "Use <b>",
  });
  const html = renderNoteHtml(record);
  assert.equal(html.includes("<b>"), false);
  assert.match(html, /&lt;b&gt;/u);
  const parsed = parseStoredRecord(html);
  assert.equal(parsed?.source, 'Use <b> & "quotes"');
  assert.equal(parsed?.kind, "explanation");
  assert.equal(parsed?.question, "Use <b>");
});
