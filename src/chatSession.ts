// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — in-memory chat sessions keyed by Zotero item key.

import type { ChatTurn } from "./providers/chatProtocol";

export const CHAT_SESSION_MAX_TURNS = 20;

const sessions = new Map<string, ChatTurn[]>();
const listeners = new Set<(itemKey: string) => void>();

export function subscribeChatSession(listener: (itemKey: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChatSession(itemKey: string): void {
  for (const listener of listeners) {
    try {
      listener(itemKey);
    } catch {
      // A closed pane must not block the next listener.
    }
  }
}

export function getChatSession(itemKey: string): ChatTurn[] {
  return (sessions.get(itemKey) || []).map((turn) => ({ ...turn }));
}

export function appendChatTurn(
  itemKey: string,
  turn: ChatTurn,
  maxTurns: number = CHAT_SESSION_MAX_TURNS,
): ChatTurn[] {
  const session = sessions.get(itemKey) || [];
  session.push({ ...turn });
  // Keep the newest exchanges; old turns fall out once the cap is reached.
  if (session.length > maxTurns) session.splice(0, session.length - maxTurns);
  sessions.set(itemKey, session);
  emitChatSession(itemKey);
  return getChatSession(itemKey);
}

export function clearChatSession(itemKey: string): void {
  sessions.delete(itemKey);
  emitChatSession(itemKey);
}

/** Test hook: plugin shutdown drops every in-memory conversation. */
export function resetChatSessions(): void {
  sessions.clear();
}
