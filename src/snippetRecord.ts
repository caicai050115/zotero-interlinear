// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — bilingual snippet and AI-explanation records stored on notes.

export const RECORD_VERSION = 1;
export const RECORD_ATTRIBUTE = "data-interlinear-record";

export type RecordKind = "snippet" | "explanation";

export interface StoredRecord {
  v: 1;
  kind: RecordKind;
  key: string;
  source: string;
  body: string;
  pageLabel: string;
  pageIndex: number | null;
  attachmentKey: string;
  annotationKey: string;
  noteKey: string;
  question: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeRecordText(value: string): string {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function recordKey(kind: RecordKind, source: string): string {
  return `${kind}:${fnv1a(normalizeRecordText(source))}`;
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function createStoredRecord(
  input: Partial<StoredRecord> & Pick<StoredRecord, "kind" | "source" | "body">,
  now = new Date().toISOString(),
): StoredRecord {
  const source = normalizeRecordText(input.source);
  const body = String(input.body || "").trim();
  return {
    v: RECORD_VERSION,
    kind: input.kind,
    key: input.key || recordKey(input.kind, source),
    source,
    body,
    pageLabel: String(input.pageLabel || "").trim(),
    pageIndex:
      typeof input.pageIndex === "number" && Number.isFinite(input.pageIndex)
        ? input.pageIndex
        : null,
    attachmentKey: String(input.attachmentKey || ""),
    annotationKey: String(input.annotationKey || ""),
    noteKey: String(input.noteKey || ""),
    question: String(input.question || "").trim(),
    title: String(input.title || "").trim(),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function renderNoteHtml(record: StoredRecord): string {
  const payload = encodeURIComponent(JSON.stringify(record));
  const heading = record.kind === "explanation" ? "Interlinear explanation" : "Interlinear";
  const bodyLabel = record.kind === "explanation" ? "Explanation" : "Translation";
  const question = record.question
    ? `<p><strong>Question</strong></p><blockquote>${escapeHtml(record.question)}</blockquote>`
    : "";
  return [
    `<h2>${heading}</h2>`,
    `<p><strong>Source</strong></p>`,
    `<blockquote class="interlinear-source-text">${escapeHtml(record.source)}</blockquote>`,
    question,
    `<p><strong>${bodyLabel}</strong></p>`,
    `<blockquote class="interlinear-body-text">${escapeHtml(record.body)}</blockquote>`,
    `<div ${RECORD_ATTRIBUTE}="${payload}"></div>`,
  ].join("");
}

export function parseStoredRecord(html: string): StoredRecord | null {
  const sourceHtml = String(html || "");
  const attribute = sourceHtml.match(
    new RegExp(`${RECORD_ATTRIBUTE}="([^"]*)"`, "u"),
  );
  if (attribute) {
    try {
      const parsed = JSON.parse(decodeURIComponent(attribute[1])) as Partial<StoredRecord>;
      if (parsed && (parsed.kind === "snippet" || parsed.kind === "explanation")) {
        return createStoredRecord(
          {
            ...parsed,
            kind: parsed.kind,
            source: String(parsed.source || ""),
            body: String(parsed.body || ""),
            createdAt: parsed.createdAt,
          },
          parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
        );
      }
    } catch {
      // Fall through to the visible blockquote recovery below.
    }
  }

  const source = textOf(sourceHtml, "interlinear-source-text");
  const body = textOf(sourceHtml, "interlinear-body-text");
  if (!source || !body) return null;
  const kind: RecordKind = /Interlinear explanation/u.test(sourceHtml)
    ? "explanation"
    : "snippet";
  return createStoredRecord({ kind, source, body, question: "" });
}

function textOf(html: string, className: string): string {
  const match = html.match(
    new RegExp(`<blockquote[^>]*class="${className}"[^>]*>([\\s\\S]*?)</blockquote>`, "u"),
  );
  if (!match) return "";
  return decodeHtml(match[1]).replace(/\s+/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&");
}

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return (hash >>> 0).toString(16);
}
