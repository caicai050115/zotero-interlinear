// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — reader selection popup and per-paragraph triggers.

import { getString } from "./utils/locale";
import { openReaderMenu } from "./readerMenu";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut, type ShortcutSpec } from "./shortcut";
import { logError } from "./utils/log";

const SOURCE_SELECTOR = "[data-ref-path]";
const TRANSLATION_CLASS = "interlinear-translation";
const RETRY_SELECTOR = `.${TRANSLATION_CLASS}[data-state="error"], .${TRANSLATION_CLASS}[data-state="paused"]`;
const POPUP_CLASS = "interlinear-selection-popup";
/** Alt-hover outline marking the paragraph that Alt+click will translate. */
const HOVER_CLASS = "interlinear-source-hover";

interface SelectionLike {
  toString(): string;
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): Range;
}

export interface SelectionContext {
  text: string;
  paragraph: string;
  pageLabel: string;
}

export type SelectionMenuMode = "combined" | "translate" | "ai";

export interface AiResultPayload {
  kind: "word" | "sentence" | "ask";
  selection: string;
  paragraph: string;
  pageLabel: string;
  answer: string;
  question?: string;
}

export interface InteractionHost {
  translateSelection(text: string): Promise<string>;
  translateParagraph(source: HTMLElement, options?: { force?: boolean }): Promise<void>;
  explainSelection?(kind: "word" | "sentence", ctx: SelectionContext): Promise<string>;
  askSelection?(question: string, ctx: SelectionContext): Promise<string>;
  saveAiResult?(payload: AiResultPayload): Promise<void>;
  saveVocabulary?(payload: AiResultPayload): Promise<void>;
  saveSnippet?(source: HTMLElement, block: HTMLElement | null): Promise<void>;
  llmAvailable?(): boolean;
  openSettings?(): void;
}

export interface InteractionOptions {
  /** Tests inject a selection because createHTMLDocument has no defaultView. */
  getSelection?: () => SelectionLike | null;
  setTimer?: (callback: () => void, delay: number) => void;
  /** Read at gesture time so settings changes apply without re-attaching. */
  getShortcutSettings?: () => { enabled: boolean; spec: ShortcutSpec | null };
  /** Width of the selection popup, read when it opens. */
  getPopupWidth?: () => number;
  /** Read when the popup opens so a settings change applies immediately. */
  getSelectionMenuMode?: () => SelectionMenuMode;
  getToggleShortcutSettings?: () => { enabled: boolean; spec: ShortcutSpec | null };
  getDisplayShortcutSettings?: () => { enabled: boolean; spec: ShortcutSpec | null };
  onToggleShortcut?: () => void;
  onCycleDisplayShortcut?: () => void;
}

export interface InteractionController {
  dispose(): void;
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function findSource(target: EventTarget | null): HTMLElement | null {
  const element = elementOf(target as Node | null);
  const source = element?.closest?.(SOURCE_SELECTOR) as HTMLElement | null;
  if (!source) return null;
  if (!source.closest("#sdt-content")) return null;
  if (source.closest(`.${TRANSLATION_CLASS}, .${POPUP_CLASS}`)) return null;
  return source;
}

function invokeParagraph(
  host: InteractionHost,
  source: HTMLElement,
  options?: { force?: boolean },
): void {
  const report = (error: unknown) => {
    try {
      logError(error as Error);
    } catch (_) {
      // Outside Zotero (unit harness) there is nowhere to report.
    }
  };
  try {
    void Promise.resolve(host.translateParagraph(source, options)).catch(report);
  } catch (error) {
    report(error);
  }
}

const SAVE_BUTTON_SELECTOR = ".interlinear-save-snippet, .interlinear-save-floating";

function actionButton(doc: Document, className: string, labelKey: Parameters<typeof getString>[0]): HTMLButtonElement {
  const button = doc.createElement("button") as HTMLButtonElement;
  button.type = "button";
  button.className = className;
  button.textContent = getString(labelKey);
  return button;
}

function createPopup(
  doc: Document,
  win: any,
  host: InteractionHost,
  getWidth: () => number,
  getMenuMode: () => SelectionMenuMode,
): {
  root: HTMLDivElement;
  show: (rect: DOMRect, text: string, context?: { paragraph: string; pageLabel: string }) => void;
  hide: () => void;
  contains: (target: EventTarget | null) => boolean;
} {
  const root = doc.createElement("div") as HTMLDivElement;
  root.className = POPUP_CLASS;
  root.hidden = true;

  const actions = doc.createElement("div");
  actions.className = "interlinear-selection-actions";

  const translateButton = doc.createElement("button") as HTMLButtonElement;
  translateButton.type = "button";
  translateButton.className = "interlinear-selection-translate";
  translateButton.textContent = getString("selection-translate-button");

  const explainWord = actionButton(doc, "interlinear-selection-word", "selection-explain-word");
  const explainSentence = actionButton(
    doc,
    "interlinear-selection-sentence",
    "selection-explain-sentence",
  );
  const askButton = actionButton(doc, "interlinear-selection-ask", "selection-ask");

  const closeButton = doc.createElement("button") as HTMLButtonElement;
  closeButton.type = "button";
  closeButton.className = "interlinear-selection-close";
  closeButton.textContent = "×";
  closeButton.title = getString("selection-close-title");
  closeButton.setAttribute("aria-label", getString("selection-close-title"));

  const askRow = doc.createElement("div");
  askRow.className = "interlinear-selection-ask-row";
  askRow.hidden = true;
  const askInput = doc.createElement("input") as HTMLInputElement;
  askInput.type = "text";
  askInput.className = "interlinear-selection-question";
  askInput.placeholder = getString("selection-ask-placeholder");
  const askSend = actionButton(doc, "interlinear-selection-ask-send", "selection-ask-send");
  askRow.append(askInput, askSend);

  const result = doc.createElement("div") as HTMLDivElement;
  result.className = "interlinear-selection-result";
  result.hidden = true;

  const aiActions = doc.createElement("div");
  aiActions.className = "interlinear-selection-ai-actions";
  aiActions.hidden = true;
  const saveNote = actionButton(doc, "interlinear-selection-save-note", "selection-save-note");
  const saveVocab = actionButton(doc, "interlinear-selection-save-vocab", "selection-save-vocab");
  const openSettings = actionButton(doc, "interlinear-selection-settings", "selection-open-settings");
  openSettings.hidden = true;
  aiActions.append(saveNote, saveVocab);

  actions.append(translateButton, explainWord, explainSentence, askButton, closeButton);
  root.append(actions, askRow, result, aiActions, openSettings);
  root.addEventListener("mousedown", (event: Event) => event.stopPropagation());
  root.addEventListener("click", (event: Event) => event.stopPropagation());

  let pendingText = "";
  let pendingParagraph = "";
  let pendingPage = "";
  let pendingAnswer = "";
  let pendingKind: AiResultPayload["kind"] = "word";
  let pendingQuestion = "";
  let busy = false;

  const context = (): SelectionContext => ({
    text: pendingText,
    paragraph: pendingParagraph,
    pageLabel: pendingPage,
  });

  const applyMode = () => {
    const mode = getMenuMode();
    const showAi = mode !== "translate";
    explainWord.hidden = !showAi;
    explainSentence.hidden = !showAi;
    askButton.hidden = !showAi;
    if (!showAi) askRow.hidden = true;
  };

  const hide = () => {
    root.hidden = true;
    result.hidden = true;
    result.textContent = "";
    result.removeAttribute("data-state");
    aiActions.hidden = true;
    askRow.hidden = true;
    openSettings.hidden = true;
    pendingAnswer = "";
  };

  const showResult = (state: string, text: string) => {
    result.hidden = false;
    result.dataset.state = state;
    result.textContent = text;
  };

  const showLlmNotice = () => {
    showResult("error", getString("selection-llm-unavailable"));
    openSettings.hidden = false;
    aiActions.hidden = true;
  };

  closeButton.addEventListener("click", (event: Event) => {
    event.preventDefault();
    hide();
  });

  openSettings.addEventListener("click", (event: Event) => {
    event.preventDefault();
    host.openSettings?.();
  });

  translateButton.addEventListener("click", async (event: Event) => {
    event.preventDefault();
    if (busy || !pendingText) return;
    busy = true;
    translateButton.disabled = true;
    translateButton.textContent = getString("selection-translating");
    aiActions.hidden = true;
    openSettings.hidden = true;
    showResult("loading", getString("selection-translating"));
    try {
      const translated = await host.translateSelection(pendingText);
      showResult("done", translated);
    } catch (error: any) {
      showResult(
        "error",
        getString("selection-error", {
          args: { detail: String(error?.message || error) },
        }),
      );
    } finally {
      busy = false;
      translateButton.disabled = false;
      translateButton.textContent = getString("selection-translate-button");
    }
  });

  const runAi = async (
    kind: AiResultPayload["kind"],
    run: () => Promise<string>,
  ) => {
    if (busy || !pendingText) return;
    if (host.llmAvailable && !host.llmAvailable()) {
      showLlmNotice();
      return;
    }
    busy = true;
    pendingKind = kind;
    pendingAnswer = "";
    aiActions.hidden = true;
    openSettings.hidden = true;
    showResult("loading", getString("selection-ai-working"));
    try {
      const answer = await run();
      pendingAnswer = answer;
      showResult("done", answer);
      aiActions.hidden = false;
    } catch (error: any) {
      const detail = String(error?.message || error);
      showResult(
        "error",
        detail === "LLM_UNAVAILABLE"
          ? getString("selection-llm-unavailable")
          : getString("selection-ai-failed", { args: { detail } }),
      );
      if (detail === "LLM_UNAVAILABLE") openSettings.hidden = false;
    } finally {
      busy = false;
    }
  };

  explainWord.addEventListener("click", (event: Event) => {
    event.preventDefault();
    void runAi("word", () => host.explainSelection?.("word", context()) || Promise.reject(new Error("LLM_UNAVAILABLE")));
  });
  explainSentence.addEventListener("click", (event: Event) => {
    event.preventDefault();
    void runAi("sentence", () =>
      host.explainSelection?.("sentence", context()) || Promise.reject(new Error("LLM_UNAVAILABLE")),
    );
  });
  askButton.addEventListener("click", (event: Event) => {
    event.preventDefault();
    askRow.hidden = false;
    askInput.focus();
  });
  const submitAsk = () => {
    const question = askInput.value.trim();
    if (!question) return;
    pendingQuestion = question;
    void runAi("ask", () =>
      host.askSelection?.(question, context()) || Promise.reject(new Error("LLM_UNAVAILABLE")),
    );
  };
  askSend.addEventListener("click", (event: Event) => {
    event.preventDefault();
    submitAsk();
  });
  askInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitAsk();
  });

  const payload = (): AiResultPayload => ({
    kind: pendingKind,
    selection: pendingText,
    paragraph: pendingParagraph,
    pageLabel: pendingPage,
    answer: pendingAnswer,
    question: pendingQuestion,
  });
  saveNote.addEventListener("click", (event: Event) => {
    event.preventDefault();
    if (!pendingAnswer) return;
    void host.saveAiResult?.(payload());
  });
  saveVocab.addEventListener("click", (event: Event) => {
    event.preventDefault();
    if (!pendingAnswer) return;
    void host.saveVocabulary?.(payload());
  });

  const show = (
    rect: DOMRect,
    text: string,
    selection?: { paragraph: string; pageLabel: string },
  ) => {
    pendingText = text;
    pendingParagraph = selection?.paragraph || "";
    pendingPage = selection?.pageLabel || "";
    pendingAnswer = "";
    pendingQuestion = "";
    askInput.value = "";
    result.hidden = true;
    result.textContent = "";
    result.removeAttribute("data-state");
    aiActions.hidden = true;
    askRow.hidden = true;
    openSettings.hidden = true;
    applyMode();
    root.hidden = false;

    const viewportWidth = Number(win?.innerWidth) || 800;
    const viewportHeight = Number(win?.innerHeight) || 600;
    const width = Math.min(
      Math.max(280, Number(getWidth()) || 380),
      Math.max(280, viewportWidth - 16),
    );
    const left = Math.max(8, Math.min(rect.left || 0, viewportWidth - width - 8));
    const top = Math.max(8, Math.min((rect.bottom || 0) + 8, viewportHeight - 140));
    root.style.width = `${width}px`;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  const container = doc.body || doc.documentElement;
  container?.append(root);

  return {
    root,
    show,
    hide,
    contains: (target) => root.contains(target as Node | null),
  };
}

async function copyText(doc: Document, text: string): Promise<boolean> {
  const win: any = doc.defaultView;
  try {
    const clipboard = win?.navigator?.clipboard;
    if (clipboard) {
      await clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // Fall back to a hidden textarea + execCommand below.
  }
  try {
    const textarea = doc.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none;";
    (doc.body || doc.documentElement)?.append(textarea);
    textarea.select();
    const ok = Boolean((doc as any).execCommand?.("copy"));
    textarea.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function showCopyNotice(doc: Document, message: string): void {
  const host = doc.body || doc.documentElement;
  if (!host) return;
  const notice = doc.createElement("div");
  notice.className = "interlinear-copy-notice";
  notice.textContent = message;
  notice.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483002;" +
    "padding:6px 12px;border-radius:6px;background:Canvas;color:CanvasText;" +
    "border:1px solid rgba(127,127,127,0.45);box-shadow:0 4px 14px rgba(0,0,0,0.25);" +
    "font-size:12px;pointer-events:none;";
  host.append(notice);
  const win: any = doc.defaultView;
  win?.setTimeout?.(() => notice.remove(), 1600);
}

export function attachReaderInteractions(
  doc: Document,
  host: InteractionHost,
  options: InteractionOptions = {},
): InteractionController {
  const win: any = doc.defaultView;
  const schedule =
    options.setTimer ||
    ((callback: () => void, delay: number) => {
      const target = win || Zotero.getMainWindow();
      target.setTimeout(callback, delay);
    });
  let disposed = false;
  let hovered: HTMLElement | null = null;
  let popup: ReturnType<typeof createPopup> | null = null;

  const getPopupWidth = options.getPopupWidth || (() => 380);
  const getMenuMode = options.getSelectionMenuMode || (() => "combined" as SelectionMenuMode);
  const getShortcutSettings =
    options.getShortcutSettings ||
    (() => ({ enabled: true, spec: parseShortcut(DEFAULT_SHORTCUT) }));

  const getSelection = (): SelectionLike | null => {
    if (options.getSelection) return options.getSelection();
    try {
      return (win?.getSelection?.() as SelectionLike) || null;
    } catch (_) {
      return null;
    }
  };

  const clearHover = () => {
    if (hovered) {
      try {
        hovered.classList.remove(HOVER_CLASS);
      } catch (_) {
        // The reader can replace its content document.
      }
      hovered = null;
    }
  };

  const hidePopup = () => {
    popup?.hide();
  };

  /**
   * Alt-hover only marks the paragraph; translation happens on Alt+click.
   * Hover-to-translate and the Ctrl modifier were removed at the user's
   * request, so there is no dwell timer here.
   */
  const onMouseMove = (event: MouseEvent) => {
    const source = findSource(event.target);
    if (floatButton.contains(event.target as Node)) return;
    if (!event.altKey) {
      clearHover();
      if (source) showFloat(source);
      else hideFloat();
      return;
    }
    hideFloat();
    if (hovered === source) return;
    clearHover();
    if (source) {
      hovered = source;
      source.classList.add(HOVER_CLASS);
    }
  };

  const onMouseLeave = () => {
    clearHover();
    hideFloat();
  };

  const onScroll = () => {
    clearHover();
    hideFloat();
  };

  const onMouseUp = () => {
    schedule(() => {
      if (disposed) return;
      const selection = getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hidePopup();
        return;
      }
      const text = selection.toString().replace(/\s+/gu, " ").trim();
      if (text.length < 2) {
        hidePopup();
        return;
      }
      const range = selection.getRangeAt(0);
      const inside = elementOf(range.commonAncestorContainer)?.closest(
        `.${TRANSLATION_CLASS}, .${POPUP_CLASS}`,
      );
      if (inside) {
        hidePopup();
        return;
      }
      popup ||= createPopup(doc, win, host, getPopupWidth, getMenuMode);
      const source = findSource(range.startContainer) || findSource(range.commonAncestorContainer);
      const block = source?.nextElementSibling as HTMLElement | null;
      const pageLabel =
        block?.classList?.contains(TRANSLATION_CLASS) ? block.dataset.sourcePage || "" : "";
      popup.show(range.getBoundingClientRect(), text.slice(0, 8000), {
        paragraph: (source?.textContent || "").replace(/\s+/gu, " ").trim(),
        pageLabel,
      });
    }, 0);
  };

  const retryBlockOf = (target: EventTarget | null): { block: HTMLElement; source: HTMLElement } | null => {
    const block = elementOf(target as Node | null)?.closest?.(RETRY_SELECTOR) as HTMLElement | null;
    if (!block) return null;
    const source = block.previousElementSibling as HTMLElement | null;
    if (!source?.matches?.(SOURCE_SELECTOR)) return null;
    return { block, source };
  };

  const retryIfRequested = (event: Event): boolean => {
    const retry = retryBlockOf(event.target);
    if (!retry) return false;
    // Let the reader select and copy error text without retrying.
    const selection = getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) return false;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    hidePopup();
    invokeParagraph(host, retry.source);
    return true;
  };

  const blockContext = (
    target: EventTarget | null,
  ): { block: HTMLElement; source: HTMLElement } | null => {
    const block = elementOf(target as Node | null)?.closest?.(
      `.${TRANSLATION_CLASS}`,
    ) as HTMLElement | null;
    if (!block) return null;
    const source = block.previousElementSibling as HTMLElement | null;
    if (!source?.matches?.(SOURCE_SELECTOR)) return null;
    return { block, source };
  };

  const showBlockMenu = (event: MouseEvent) => {
    const target = blockContext(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    hidePopup();
    const { block, source } = target;
    openReaderMenu(doc, {
      x: event.clientX,
      y: event.clientY,
      entries: [
        { action: "retranslate", label: getString("block-menu-retranslate") },
        {
          action: "copy-translation",
          label: getString("block-menu-copy-translation"),
          disabled: !(block.textContent || "").trim(),
        },
        {
          action: "copy-source",
          label: getString("block-menu-copy-source"),
          disabled: !(source.textContent || "").trim(),
        },
        ...(host.saveSnippet
          ? [{ action: "save-snippet", label: getString("snippet-menu-save") }]
          : []),
      ],
      onSelect: (action) => {
        if (action === "save-snippet") {
          void host.saveSnippet?.(source, block);
          return;
        }
        if (action === "retranslate") {
          invokeParagraph(host, source, { force: true });
          return;
        }
        const text =
          action === "copy-source" ? source.textContent || "" : block.textContent || "";
        void copyText(doc, text).then((ok) =>
          showCopyNotice(
            doc,
            getString(ok ? "block-menu-copied" : "block-menu-copy-failed"),
          ),
        );
      },
    });
  };

  const onContextMenu = (event: MouseEvent) => showBlockMenu(event);
  const onDoubleClick = (event: MouseEvent) => showBlockMenu(event);

  const floatButton = doc.createElement("button") as HTMLButtonElement;
  floatButton.type = "button";
  floatButton.className = "interlinear-save-floating";
  floatButton.hidden = true;
  floatButton.tabIndex = -1;
  floatButton.textContent = "+";
  floatButton.setAttribute("aria-label", getString("snippet-save"));
  floatButton.title = getString("snippet-save");
  floatButton.style.cssText =
    "position:fixed;z-index:2147482000;width:22px;height:22px;padding:0;border:1px solid rgba(127,127,127,0.45);" +
    "border-radius:4px;background:Canvas;color:CanvasText;cursor:pointer;line-height:20px;";
  (doc.body || doc.documentElement)?.append(floatButton);
  let floatSource: HTMLElement | null = null;

  const hideFloat = () => {
    floatButton.hidden = true;
    floatSource = null;
  };
  const showFloat = (source: HTMLElement) => {
    if (!host.saveSnippet) return;
    const rect = source.getBoundingClientRect?.();
    if (!rect) return;
    floatSource = source;
    floatButton.hidden = false;
    const left = Math.max(8, (rect.right || 0) - 28);
    const top = Math.max(8, rect.top || 0);
    floatButton.style.left = `${left}px`;
    floatButton.style.top = `${top}px`;
  };

  const saveFrom = (source: HTMLElement | null) => {
    if (!source || !host.saveSnippet) return;
    const sibling = source.nextElementSibling as HTMLElement | null;
    const block = sibling?.classList?.contains(TRANSLATION_CLASS) ? sibling : null;
    void host.saveSnippet(source, block);
  };

  const onClick = (event: MouseEvent) => {
    const clicked = elementOf(event.target as Node | null);
    if (clicked?.closest?.(SAVE_BUTTON_SELECTOR)) {
      event.preventDefault();
      event.stopPropagation();
      const inline = clicked.closest?.(`.${TRANSLATION_CLASS}`) as HTMLElement | null;
      const source = inline
        ? (inline.previousElementSibling as HTMLElement | null)
        : floatSource;
      saveFrom(source);
      hideFloat();
      return;
    }
    if (retryIfRequested(event)) return;
    if (!event.altKey) return;
    const source = findSource(event.target);
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    invokeParagraph(host, source);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      hidePopup();
      clearHover();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && retryIfRequested(event)) {
      return;
    }

    const toggleShortcut = options.getToggleShortcutSettings?.();
    if (
      toggleShortcut?.enabled &&
      toggleShortcut.spec &&
      matchesShortcut(event, toggleShortcut.spec)
    ) {
      event.preventDefault();
      event.stopPropagation();
      options.onToggleShortcut?.();
      return;
    }
    const displayShortcut = options.getDisplayShortcutSettings?.();
    if (
      displayShortcut?.enabled &&
      displayShortcut.spec &&
      matchesShortcut(event, displayShortcut.spec)
    ) {
      event.preventDefault();
      event.stopPropagation();
      options.onCycleDisplayShortcut?.();
      return;
    }

    const shortcut = getShortcutSettings();
    if (!shortcut.enabled || !shortcut.spec || event.repeat) return;
    if (!matchesShortcut(event, shortcut.spec)) return;
    const target = elementOf(event.target as Node);
    if (target?.closest(`.${POPUP_CLASS}`)) return;

    let source = hovered && hovered.isConnected ? hovered : null;
    if (!source) {
      const selection = getSelection();
      if (selection?.rangeCount) {
        source = findSource(selection.getRangeAt(0).startContainer);
      }
    }
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    clearHover();
    invokeParagraph(host, source);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (popup && !popup.contains(event.target)) hidePopup();
  };

  const onWindowBlur = () => clearHover();

  doc.addEventListener("mousemove", onMouseMove, true);
  doc.addEventListener("mouseleave", onMouseLeave, true);
  doc.addEventListener("mouseup", onMouseUp, true);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("contextmenu", onContextMenu, true);
  doc.addEventListener("dblclick", onDoubleClick, true);
  try {
    win?.addEventListener?.("blur", onWindowBlur);
  } catch (_) {
    // Detached test documents have no window.
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearHover();
      try {
        popup?.root.remove();
        floatButton.remove();
      } catch (_) {
        // The iframe may already be gone.
      }
      doc.removeEventListener("mousemove", onMouseMove, true);
      doc.removeEventListener("mouseleave", onMouseLeave, true);
      doc.removeEventListener("mouseup", onMouseUp, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("mousedown", onMouseDown, true);
      doc.removeEventListener("scroll", onScroll, true);
      doc.removeEventListener("contextmenu", onContextMenu, true);
      doc.removeEventListener("dblclick", onDoubleClick, true);
      try {
        win?.removeEventListener?.("blur", onWindowBlur);
      } catch (_) {
        // The iframe may already be gone.
      }
    },
  };
}
