// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — local vocabulary list, exportable as Anki CSV.

export interface VocabEntry {
  id: string;
  word: string;
  context: string;
  explanation: string;
  source: string;
  itemKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface VocabInput {
  word: string;
  context: string;
  explanation: string;
  source: string;
  itemKey: string;
  id?: string;
  createdAt?: string;
}

export function createVocabId(now = Date.now(), random = Math.random()): string {
  return `v-${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
}

export function parseVocabulary(json: string): VocabEntry[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((entry): entry is VocabEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function upsertVocabulary(
  entries: readonly VocabEntry[],
  input: VocabInput,
  now = new Date().toISOString(),
): { entries: VocabEntry[]; entry: VocabEntry } {
  const word = input.word.replace(/\s+/gu, " ").trim();
  const nextEntry: VocabEntry = {
    id: input.id || createVocabId(),
    word,
    context: input.context.replace(/\s+/gu, " ").trim(),
    explanation: input.explanation.trim(),
    source: input.source.trim(),
    itemKey: input.itemKey.trim(),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  const index = entries.findIndex(
    (entry) =>
      entry.itemKey === nextEntry.itemKey &&
      entry.word.localeCompare(nextEntry.word, undefined, { sensitivity: "accent" }) === 0,
  );
  if (index < 0) {
    return { entries: [...entries, nextEntry], entry: nextEntry };
  }
  const previous = entries[index];
  const updated: VocabEntry = {
    ...nextEntry,
    id: previous.id,
    createdAt: previous.createdAt,
  };
  const copy = entries.slice();
  copy[index] = updated;
  return { entries: copy, entry: updated };
}

/**
 * Anki's CSV importer understands `#separator:Comma` and a header row.
 * Map Word → Front and Explanation → Back, or use a note type with these fields.
 */
export function renderAnkiCsv(entries: readonly VocabEntry[]): string {
  const lines = [
    "#separator:Comma",
    "#html:false",
    "#columns:Word,Context,Explanation,Source,ItemKey,Created",
    row(["Word", "Context", "Explanation", "Source", "ItemKey", "Created"]),
  ];
  for (const entry of entries) {
    lines.push(
      row([
        entry.word,
        entry.context,
        entry.explanation,
        entry.source,
        entry.itemKey,
        entry.createdAt,
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

function normalizeEntry(value: unknown): VocabEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<VocabEntry>;
  const word = String(record.word || "").trim();
  if (!word) return null;
  return {
    id: String(record.id || createVocabId()),
    word,
    context: String(record.context || ""),
    explanation: String(record.explanation || ""),
    source: String(record.source || ""),
    itemKey: String(record.itemKey || ""),
    createdAt: String(record.createdAt || ""),
    updatedAt: String(record.updatedAt || record.createdAt || ""),
  };
}

function row(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function csvCell(value: string): string {
  const text = String(value || "").replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  if (/[",\n]/u.test(text)) return `"${text.replace(/"/gu, '""')}"`;
  return text;
}
