import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenPdfLink,
  buildSelectLink,
  filenameFieldsFromMeta,
  renderExportFilename,
  renderObsidianMarkdown,
  zoteroLibrarySegment,
} from "../src/obsidianMarkdown.ts";
import { createStoredRecord } from "../src/snippetRecord.ts";

const meta = {
  title: 'Attention: "all" you need',
  authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki"],
  year: "2017",
  doi: "10.0000/example",
  citekey: "vaswani2017attention",
  itemKey: "ITEMKEY",
  selectLink: "zotero://select/library/items/ITEMKEY",
  tags: ["transformer", "nlp"],
  librarySegment: "library",
  attachmentKey: "PDFKEY",
};

test("frontmatter keeps the fields Obsidian and Zotero need", () => {
  const markdown = renderObsidianMarkdown(meta, [
    createStoredRecord({
      kind: "snippet",
      source: "Line one",
      body: "第一行",
      pageLabel: "2",
      pageIndex: 1,
      attachmentKey: "PDFKEY",
      annotationKey: "ANN",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  assert.match(markdown, /title: "Attention: \\"all\\" you need"/u);
  assert.match(markdown, /citekey: "vaswani2017attention"/u);
  assert.match(markdown, /doi: "10.0000\/example"/u);
  assert.match(markdown, /zotero: "zotero:\/\/select\/library\/items\/ITEMKEY"/u);
  assert.match(markdown, /  - "transformer"/u);
  assert.match(markdown, /\[Open in Zotero\]\(zotero:\/\/open-pdf\/library\/items\/PDFKEY\?page=2&annotation=ANN\)/u);
  assert.match(markdown, /> Line one/u);
  assert.match(markdown, /> 第一行/u);
});

test("re-export filename is stable and citekey falls back to the item key", () => {
  const fields = filenameFieldsFromMeta(meta);
  assert.equal(renderExportFilename("{{citekey}}.md", fields), "vaswani2017attention.md");
  assert.equal(
    renderExportFilename("{{year}} {{authors}} - {{title}}", fields),
    "2017 Vaswani et al - Attention all you need.md",
  );
  assert.equal(
    renderExportFilename("{{citekey}}.md", { ...fields, citekey: "" }),
    "ITEMKEY.md",
  );
});

test("group libraries use the groups path", () => {
  assert.equal(zoteroLibrarySegment({ libraryType: "user" }), "library");
  assert.equal(zoteroLibrarySegment({ libraryType: "group", groupID: 42 }), "groups/42");
  assert.equal(
    buildSelectLink("groups/42", "ITEM KEY"),
    "zotero://select/groups/42/items/ITEM%20KEY",
  );
  assert.equal(buildOpenPdfLink("library", "", "1", ""), "");
});
