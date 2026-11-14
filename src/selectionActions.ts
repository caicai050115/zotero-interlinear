// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — run a selection prompt and keep the answer for export.

import { appendChatTurn } from "./chatSession";
import { getChatProvider } from "./providers";
import {
  buildAskPrompt,
  buildExplainSentencePrompt,
  buildExplainWordPrompt,
  buildSelectionSystemPrompt,
  resolveAnswerLanguage,
  type ExplainKind,
} from "./selectionAssist";
import { saveReadingRecord, sourceLabel } from "./readingNotes";
import { recordKey } from "./snippetRecord";
import { getEngine, getGlossaryDirective, getTargetLanguage } from "./settings";
import { whenSecretsReady } from "./secrets";
import { addVocabularyEntry } from "./vocabularyStore";

export interface SelectionRequest {
  kind: ExplainKind | "ask";
  selection: string;
  paragraph: string;
  pageLabel: string;
  question?: string;
  readerItemID: number;
}

export function llmAvailable(): boolean {
  return getChatProvider(getEngine()) !== null;
}

export async function answerSelection(request: SelectionRequest): Promise<string> {
  await whenSecretsReady();
  const provider = getChatProvider(getEngine(), () =>
    buildSelectionSystemPrompt(
      resolveAnswerLanguage((Zotero as any).locale, getTargetLanguage()),
      getGlossaryDirective(),
    ),
  );
  if (!provider) {
    throw new Error("LLM_UNAVAILABLE");
  }
  const user = request.kind === "word"
    ? buildExplainWordPrompt(request.selection, request.paragraph)
    : request.kind === "sentence"
      ? buildExplainSentencePrompt(request.selection, request.paragraph)
      : buildAskPrompt(request.question || "", request.selection, request.paragraph);
  const answer = (await provider.chat([{ role: "user", content: user }])).trim();
  if (!answer) throw new Error("Empty answer");
  for (const itemKey of chatItemKeys(request.readerItemID)) {
    appendChatTurn(itemKey, { role: "user", content: sidebarQuestion(request) });
    appendChatTurn(itemKey, { role: "assistant", content: answer });
  }
  return answer;
}

export async function saveSelectionAnswer(request: SelectionRequest, answer: string): Promise<void> {
  const title = request.kind === "ask"
    ? `Ask AI: ${clip(request.question || request.selection, 80)}`
    : request.kind === "word"
      ? `Explain word: ${clip(request.selection, 80)}`
      : `Explain sentence: ${clip(request.selection, 80)}`;
  await saveReadingRecord({
    readerItemID: request.readerItemID,
    kind: "explanation",
    key: recordKey(
      "explanation",
      `${request.kind}\n${request.selection}\n${request.question || ""}`,
    ),
    source: request.paragraph || request.selection,
    body: answer,
    pageLabel: request.pageLabel,
    title,
    question: request.kind === "ask" ? request.question || "" : request.selection,
  });
}

export async function saveSelectionVocabulary(request: SelectionRequest, answer: string): Promise<void> {
  const item = Zotero.Items.get(request.readerItemID);
  const parent = item?.parentItem || item;
  await addVocabularyEntry({
    word: clip(request.selection, 200),
    context: request.paragraph || request.selection,
    explanation: answer,
    source: sourceLabel(parent),
    itemKey: String(parent?.key || item?.key || ""),
  });
}

function sidebarQuestion(request: SelectionRequest): string {
  if (request.kind === "ask") return request.question || request.selection;
  if (request.kind === "word") return `Explain word: ${request.selection}`;
  return `Explain sentence: ${request.selection}`;
}

function chatItemKeys(readerItemID: number): string[] {
  const keys = new Set<string>();
  const item = Zotero.Items.get(readerItemID);
  if (item?.key) keys.add(String(item.key));
  if (item?.parentItem?.key) keys.add(String(item.parentItem.key));
  return [...keys];
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
