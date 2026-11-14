// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — Obsidian-flavoured Markdown for saved bilingual snippets.

import type { StoredRecord } from "./snippetRecord";

export const DEFAULT_FILENAME_TEMPLATE = "{{citekey}}.md";

export interface ExportMeta {
  title: string;
  authors: string[];
  year: string;
  doi: string;
  citekey: string;
  itemKey: string;
  selectLink: string;
  tags: string[];
  librarySegment: string;
  attachmentKey: string;
}

export interface FilenameFields {
  citekey: string;
  title: string;
  year: string;
  authors: string;
  doi: string;
  itemKey: string;
}

export function zoteroLibrarySegment(input: {
  libraryType?: string;
  groupID?: number;
}): string {
  if (input.libraryType === "group" && input.groupID) return `groups/${input.groupID}`;
  return "library";
}

export function buildSelectLink(librarySegment: string, itemKey: string): string {
  return `zotero://select/${librarySegment}/items/${encodeURIComponent(itemKey)}`;
}

export function buildOpenPdfLink(
  librarySegment: string,
  attachmentKey: string,
  pageLabel: string,
  annotationKey: string,
): string {
  if (!attachmentKey) return "";
  const base = `zotero://open-pdf/${librarySegment}/items/${encodeURIComponent(attachmentKey)}`;
  const params = new URLSearchParams();
  if (pageLabel) params.set("page", pageLabel);
  if (annotationKey) params.set("annotation", annotationKey);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function formatAuthorToken(authors: readonly string[]): string {
  const names = authors.map(familyName).filter(Boolean);
  if (!names.length) return "Unknown";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} et al`;
}

export function yearFromDate(value: string): string {
  const match = String(value || "").match(/\d{4}/u);
  return match ? match[0] : "";
}

export function joinPath(dir: string, name: string): string {
  const slash = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/u, "")}${slash}${name}`;
}

export function sanitizeFilename(name: string): string {
  let cleaned = "";
  for (const char of String(name || "")) {
    const code = char.codePointAt(0) || 0;
    cleaned += code < 32 || `<>:"/\\|?*`.includes(char) ? " " : char;
  }
  cleaned = cleaned.replace(/\s+/gu, " ").trim().replace(/^\.+/u, "").slice(0, 180);
  return cleaned || "interlinear";
}

export function renderExportFilename(template: string, fields: FilenameFields): string {
  const citekey = fields.citekey || fields.itemKey || "interlinear";
  const raw = (template || DEFAULT_FILENAME_TEMPLATE).replace(
    /\{\{\s*(citekey|title|year|authors|doi|itemKey)\s*\}\}/giu,
    (_match, token: string) => {
      const key = token.toLowerCase();
      if (key === "citekey") return citekey;
      if (key === "title") return fields.title || "Untitled";
      if (key === "year") return fields.year || "";
      if (key === "authors") return fields.authors || "Unknown";
      if (key === "doi") return fields.doi || "";
      return fields.itemKey || "item";
    },
  );
  let name = sanitizeFilename(raw);
  if (!name.toLowerCase().endsWith(".md")) name += ".md";
  return name;
}

export function renderObsidianMarkdown(meta: ExportMeta, records: readonly StoredRecord[]): string {
  const lines = [
    "---",
    `title: ${yamlString(meta.title || "Untitled")}`,
    ...(meta.authors.length
      ? ["authors:", ...meta.authors.map((author) => `  - ${yamlString(author)}`)]
      : ["authors: []"]),
    `year: ${yamlString(meta.year)}`,
    `doi: ${yamlString(meta.doi)}`,
    `citekey: ${yamlString(meta.citekey)}`,
    `zotero: ${yamlString(meta.selectLink)}`,
    ...(meta.tags.length
      ? ["tags:", ...meta.tags.map((tag) => `  - ${yamlString(tag)}`)]
      : ["tags: []"]),
    "---",
    "",
  ];

  if (!records.length) {
    lines.push("_No saved bilingual snippets yet._", "");
    return lines.join("\n");
  }

  for (const record of records) {
    const page = record.pageLabel || (record.pageIndex !== null ? String(record.pageIndex + 1) : "");
    const heading = record.kind === "explanation"
      ? record.title || "AI explanation"
      : page
        ? `Page ${page}`
        : "Snippet";
    lines.push(`## ${heading}`, "");
    const link = buildOpenPdfLink(
      meta.librarySegment,
      record.attachmentKey || meta.attachmentKey,
      page,
      record.annotationKey,
    );
    if (link) {
      lines.push(`[Open in Zotero](${link})`, "");
    }
    if (record.question) {
      lines.push("**Question**", "", blockquote(record.question), "");
    }
    lines.push("**Source**", "", blockquote(record.source), "");
    lines.push(record.kind === "explanation" ? "**Explanation**" : "**Translation**", "");
    lines.push(blockquote(record.body), "");
  }

  return lines.join("\n");
}

export function filenameFieldsFromMeta(meta: ExportMeta): FilenameFields {
  return {
    citekey: meta.citekey,
    title: meta.title,
    year: meta.year,
    authors: formatAuthorToken(meta.authors),
    doi: meta.doi,
    itemKey: meta.itemKey,
  };
}

function familyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (trimmed.includes(",")) return trimmed.split(",")[0]?.trim() || trimmed;
  const parts = trimmed.split(/\s+/u);
  return parts[parts.length - 1] || trimmed;
}

function yamlString(value: string): string {
  return `"${String(value || "")
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\r?\n/gu, "\\n")}"`;
}

function blockquote(value: string): string {
  const lines = String(value || "").replace(/\r\n/gu, "\n").split("\n");
  if (!lines.length) return ">";
  return lines.map((line) => `> ${line}`).join("\n");
}
