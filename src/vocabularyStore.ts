// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — vocabulary list persisted in the Zotero data directory.

import { joinPath } from "./obsidianMarkdown";
import {
  parseVocabulary,
  renderAnkiCsv,
  upsertVocabulary,
  type VocabEntry,
  type VocabInput,
} from "./vocabulary";

const FILE_NAME = "interlinear-vocabulary.json";

export async function readVocabulary(): Promise<VocabEntry[]> {
  try {
    const contents = await Zotero.File.getContentsAsync(vocabularyPath(), "utf-8");
    const text = typeof contents === "string" ? contents : new TextDecoder("utf-8").decode(contents as Uint8Array);
    return parseVocabulary(text);
  } catch {
    return [];
  }
}

export async function addVocabularyEntry(input: VocabInput): Promise<VocabEntry> {
  const current = await readVocabulary();
  const result = upsertVocabulary(current, input);
  await Zotero.File.putContentsAsync(
    vocabularyPath(),
    JSON.stringify(result.entries, null, 2),
    "utf-8",
  );
  return result.entry;
}

export async function exportVocabularyFile(
  title: string,
): Promise<{ path: string; count: number } | null> {
  const { csv, count } = await vocabularyCsv();
  if (!count) throw new Error("EMPTY");
  const picked = await new ztoolkit.FilePicker(
    title,
    "save",
    [["CSV", "*.csv"]],
    "interlinear-vocabulary.csv",
  ).open();
  if (!picked || typeof picked !== "string") return null;
  const path = picked.toLowerCase().endsWith(".csv") ? picked : `${picked}.csv`;
  await Zotero.File.putContentsAsync(path, csv, "utf-8");
  return { path, count };
}

export async function vocabularyCsv(): Promise<{ csv: string; count: number }> {
  const entries = await readVocabulary();
  return { csv: renderAnkiCsv(entries), count: entries.length };
}

export function vocabularyPath(): string {
  const dir = (Zotero as any).DataDirectory?.dir;
  if (!dir) throw new Error("Zotero data directory is unavailable");
  return joinPath(String(dir), FILE_NAME);
}
