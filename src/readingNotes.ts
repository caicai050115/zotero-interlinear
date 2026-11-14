// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — save bilingual snippets to Zotero and export them as Markdown.

import {
  buildSelectLink,
  filenameFieldsFromMeta,
  joinPath,
  renderExportFilename,
  renderObsidianMarkdown,
  yearFromDate,
  zoteroLibrarySegment,
  type ExportMeta,
} from "./obsidianMarkdown";
import {
  createStoredRecord,
  parseStoredRecord,
  recordKey,
  renderNoteHtml,
  type RecordKind,
  type StoredRecord,
} from "./snippetRecord";
import {
  getExportFilenameTemplate,
  getExportFolder,
  getSnippetDestination,
  type SnippetDestination,
} from "./settings";
import { logError } from "./utils/log";

const SNIPPET_TAG = "interlinear";

export class NotesExportError extends Error {
  code: "NO_FOLDER" | "EMPTY" | "NO_ITEM" | "WRITE";

  constructor(code: NotesExportError["code"], message: string) {
    super(message);
    this.name = "NotesExportError";
    this.code = code;
  }
}

export interface SaveSnippetInput {
  readerItemID: number;
  source: string;
  body: string;
  kind: RecordKind;
  pageLabel?: string;
  title?: string;
  question?: string;
  /** Stable identity. Explanations of different selections in one paragraph must not collide. */
  key?: string;
  destination?: SnippetDestination;
}

export async function saveReadingRecord(input: SaveSnippetInput): Promise<StoredRecord> {
  const located = locateItems(input.readerItemID);
  if (!located) throw new NotesExportError("NO_ITEM", "Missing Zotero item");
  const destination = input.kind === "explanation"
    ? "note"
    : input.destination || getSnippetDestination();
  const writeAnnotation = destination !== "note" && Boolean(located.attachment);
  const writeNote = destination !== "annotation" || !located.attachment;
  const pageLabel = String(input.pageLabel || "").trim();
  const pageIndex = pageIndexFromLabel(pageLabel);
  let record = createStoredRecord({
    kind: input.kind,
    key: input.key,
    source: input.source,
    body: input.body,
    pageLabel,
    pageIndex,
    attachmentKey: String(located.attachment?.key || ""),
    title: input.title || "",
    question: input.question || "",
  });

  if (writeNote) {
    record = { ...record, noteKey: await upsertNote(located.parent, record) };
  }
  if (writeAnnotation && located.attachment) {
    try {
      record = {
        ...record,
        annotationKey: await upsertAnnotation(located.attachment, record),
      };
      if (writeNote) await rewriteNote(located.parent, record);
    } catch (error) {
      logError(error as Error);
      // A note-only success is still useful when the PDF rejects the highlight.
      if (!writeNote) throw error;
    }
  }
  return record;
}

export async function exportReaderItemMarkdown(readerItemID: number): Promise<{
  path: string;
  count: number;
}> {
  const folder = getExportFolder();
  if (!folder) throw new NotesExportError("NO_FOLDER", "Export folder is empty");
  const located = locateItems(readerItemID);
  if (!located) throw new NotesExportError("NO_ITEM", "Missing Zotero item");
  const records = collectRecords(located.parent, located.attachment);
  if (!records.length) throw new NotesExportError("EMPTY", "No saved snippets");
  const meta = readMeta(located.parent, located.attachment);
  const markdown = renderObsidianMarkdown(meta, records);
  const filename = renderExportFilename(
    getExportFilenameTemplate(),
    filenameFieldsFromMeta(meta),
  );
  const path = joinPath(folder, filename);
  await ensureDirectory(folder);
  await Zotero.File.putContentsAsync(path, markdown, "utf-8");
  return { path, count: records.length };
}

export function collectRecords(parent: any, attachment: any): StoredRecord[] {
  const records: StoredRecord[] = [];
  const seen = new Set<string>();
  const noteParents = [parent];
  if (attachment && attachment.id !== parent?.id) noteParents.push(attachment);
  for (const owner of noteParents) {
    for (const note of notesOf(owner)) {
      const record = parseStoredRecord(String(note.getNote?.() || ""));
      if (!record || seen.has(record.key)) continue;
      record.noteKey = String(note.key || record.noteKey || "");
      seen.add(record.key);
      records.push(record);
    }
  }
  if (attachment?.getAnnotations) {
    let annotations: any[] = [];
    try {
      annotations = attachment.getAnnotations(false) || [];
    } catch (error) {
      logError(error as Error);
    }
    for (const annotation of annotations) {
      if (!hasTag(annotation, SNIPPET_TAG)) continue;
      const source = String(annotation.annotationText || "");
      const body = String(annotation.annotationComment || "");
      if (!source.trim() && !body.trim()) continue;
      const key = recordKey("snippet", source);
      const existing = records.find((record) => record.key === key);
      if (existing) {
        if (!existing.annotationKey) existing.annotationKey = String(annotation.key || "");
        continue;
      }
      records.push(
        createStoredRecord({
          kind: "snippet",
          key,
          source,
          body,
          pageLabel: String(annotation.annotationPageLabel || ""),
          attachmentKey: String(attachment.key || ""),
          annotationKey: String(annotation.key || ""),
        }),
      );
    }
  }
  records.sort(compareRecords);
  return records;
}

function compareRecords(a: StoredRecord, b: StoredRecord): number {
  const pageA = a.pageIndex ?? Number.MAX_SAFE_INTEGER;
  const pageB = b.pageIndex ?? Number.MAX_SAFE_INTEGER;
  if (pageA !== pageB) return pageA - pageB;
  if (a.kind !== b.kind) return a.kind === "snippet" ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt);
}

function locateItems(readerItemID: number): { parent: any; attachment: any | null } | null {
  if (!readerItemID) return null;
  const item = Zotero.Items.get(readerItemID);
  if (!item) return null;
  const attachment = pdfAttachment(item);
  const parent = parentItem(item) || attachment || item;
  return { parent, attachment };
}

function parentItem(item: any): any {
  try {
    if (typeof item.isAttachment === "function" && item.isAttachment()) {
      return item.parentItem || item;
    }
  } catch {
    // The item may already have been deleted.
  }
  return item;
}

function pdfAttachment(item: any): any | null {
  try {
    if (typeof item.isPDFAttachment === "function" && item.isPDFAttachment()) return item;
  } catch {
    return null;
  }
  try {
    const ids: number[] = item.getAttachments?.() || [];
    for (const id of ids) {
      const child = Zotero.Items.get(id);
      if (child?.isPDFAttachment?.()) return child;
    }
  } catch {
    return null;
  }
  return null;
}

function notesOf(item: any): any[] {
  if (!item?.getNotes) return [];
  try {
    return (item.getNotes(false) as number[])
      .map((id) => Zotero.Items.get(id))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findNote(parent: any, key: string): any | null {
  return notesOf(parent).find((note) => parseStoredRecord(String(note.getNote?.() || ""))?.key === key) || null;
}

async function rewriteNote(parent: any, record: StoredRecord): Promise<void> {
  const note = findNote(parent, record.key);
  if (!note) return;
  note.setNote(renderNoteHtml({ ...record, noteKey: String(note.key || record.noteKey) }));
  await note.saveTx();
}

async function upsertNote(parent: any, record: StoredRecord): Promise<string> {
  const existing = findNote(parent, record.key);
  if (existing) {
    existing.setNote(renderNoteHtml(record));
    await existing.saveTx();
    return String(existing.key || "");
  }
  const note = new Zotero.Item("note");
  if (parent.libraryID) note.libraryID = parent.libraryID;
  note.parentID = parent.id;
  note.setNote(renderNoteHtml(record));
  await note.saveTx();
  return String(note.key || "");
}

async function upsertAnnotation(attachment: any, record: StoredRecord): Promise<string> {
  const existing = (attachment.getAnnotations?.(false) || []).find((annotation: any) => {
    return hasTag(annotation, SNIPPET_TAG) && recordKey("snippet", annotation.annotationText || "") === record.key;
  });
  if (existing) {
    existing.annotationComment = record.body;
    if (record.pageLabel) existing.annotationPageLabel = record.pageLabel;
    if (!hasTag(existing, SNIPPET_TAG)) existing.addTag?.(SNIPPET_TAG);
    await existing.saveTx();
    return String(existing.key || "");
  }
  const pageIndex = record.pageIndex ?? 0;
  const saved = await Zotero.Annotations.saveFromJSON(attachment, {
    type: "highlight",
    text: record.source,
    comment: record.body,
    color: "#ffd400",
    pageLabel: record.pageLabel || String(pageIndex + 1),
    sortIndex: `${String(pageIndex).padStart(5, "0")}|000000|00000`,
    position: {
      pageIndex,
      // Reading mode does not expose PDF quads. Anchor a short highlight at
      // the top of the page so open-pdf can still focus that page.
      rects: [[72, 700, 540, 720]],
    },
    tags: [{ name: SNIPPET_TAG }],
  } as any);
  return String(saved?.key || "");
}

function hasTag(item: any, tag: string): boolean {
  try {
    const tags = item.getTags?.() || [];
    return tags.some((entry: { tag?: string }) => entry?.tag === tag);
  } catch {
    return false;
  }
}

function readMeta(parent: any, attachment: any): ExportMeta {
  const libraryType = libraryTypeOf(parent);
  const groupID = groupIdOf(parent);
  const segment = zoteroLibrarySegment({ libraryType, groupID });
  const authors = formatCreators(parent.getCreators?.() || []);
  const tags = (parent.getTags?.() || [])
    .map((entry: { tag?: string }) => String(entry?.tag || ""))
    .filter(Boolean);
  const itemKey = String(parent.key || "");
  return {
    title: String(parent.getField?.("title") || ""),
    authors,
    year: yearFromDate(String(parent.getField?.("date") || parent.getField?.("year") || "")),
    doi: String(parent.getField?.("DOI") || ""),
    citekey: readCitekey(parent),
    itemKey,
    selectLink: itemKey ? buildSelectLink(segment, itemKey) : "",
    tags,
    librarySegment: segment,
    attachmentKey: String(attachment?.key || ""),
  };
}

function formatCreators(creators: any[]): string[] {
  return creators
    .filter((creator) => !creator?.creatorType || creator.creatorType === "author")
    .map((creator) => {
      if (creator.name) return String(creator.name);
      return [creator.lastName, creator.firstName].filter(Boolean).join(", ");
    })
    .map((name: string) => name.trim())
    .filter(Boolean);
}

function readCitekey(item: any): string {
  try {
    const managed = (Zotero as any).BetterBibTeX?.KeyManager?.get?.(item.id)?.citekey;
    if (managed) return String(managed);
  } catch {
    // Better BibTeX is optional.
  }
  try {
    const field = item.getField?.("citationKey");
    if (field) return String(field);
  } catch {
    // The field exists only when a citekey plugin registers it.
  }
  const extra = String(item.getField?.("extra") || "");
  const match = extra.match(/(?:^|\n)\s*(?:Citation Key|citekey)\s*:\s*(\S+)/iu);
  return match?.[1] || "";
}

function libraryTypeOf(item: any): string {
  try {
    const library = Zotero.Libraries.get(item.libraryID);
    if (!library) return "user";
    return String((library as { libraryType?: string }).libraryType || "user");
  } catch {
    return "user";
  }
}

function groupIdOf(item: any): number | undefined {
  try {
    const library = Zotero.Libraries.get(item.libraryID);
    if (!library) return undefined;
    return (library as { groupID?: number }).groupID;
  } catch {
    return undefined;
  }
}

function pageIndexFromLabel(pageLabel: string): number | null {
  if (!/^\d+$/u.test(pageLabel)) return null;
  const page = Number(pageLabel);
  if (!Number.isFinite(page) || page < 1) return null;
  return page - 1;
}

async function ensureDirectory(path: string): Promise<void> {
  const io = (globalThis as { IOUtils?: { makeDirectory?: (path: string, options?: object) => Promise<void> } }).IOUtils;
  if (!io?.makeDirectory) return;
  await io.makeDirectory(path, { ignoreExisting: true, createAncestors: true });
}

export function sourceLabel(item: any): string {
  const authors = formatCreators(item?.getCreators?.() || []);
  const year = yearFromDate(String(item?.getField?.("date") || item?.getField?.("year") || ""));
  const title = String(item?.getField?.("title") || "");
  const who = authors.length ? authors[0] : "";
  return [who, year && `(${year})`, title].filter(Boolean).join(" ");
}
