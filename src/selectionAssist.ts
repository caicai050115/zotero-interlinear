// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — prompts for the selection AI menu.
//
// Model-facing text follows the same Chinese instruction style as the
// translation prompts. The answer language is chosen by the caller.

export type ExplainKind = "word" | "sentence";

// Display names for the answer-language instruction. Kept in this module so
// Node tests can load it without the provider graph. The codes match prompts.ts.
const ANSWER_LANGUAGE_NAMES: Record<string, string> = {
  auto: "原文",
  en: "英文",
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  ja: "日文",
  ko: "韩文",
  fr: "法文",
  de: "德文",
  es: "西班牙文",
  ru: "俄文",
  pt: "葡萄牙文",
  it: "意大利文",
  ar: "阿拉伯文",
  hi: "印地文",
};

export interface AssistPrompt {
  system: string;
  user: string;
}

export function resolveAnswerLanguage(uiLocale: string | undefined, targetCode: string | undefined): string {
  const ui = String(uiLocale || "").toLowerCase();
  if (ui.startsWith("zh-tw") || ui.startsWith("zh-hk") || ui.includes("hant")) return "繁体中文";
  if (ui.startsWith("zh")) return "简体中文";
  const code = targetCode || "zh-CN";
  return ANSWER_LANGUAGE_NAMES[code] || code;
}

export function buildSelectionSystemPrompt(answerLanguage: string, glossary: string): string {
  const lines = [
    "你是一名严谨的学术文献阅读助手。",
    `请始终使用${answerLanguage}回答。`,
    "只依据用户给出的选区和所在段落。不要编造文中没有的数据、引用或页码。",
    "如果读音或词性不确定，直接写“不确定”，不要猜测。",
  ];
  if (glossary) {
    lines.push("", "解释术语时遵守下面的术语表：", "", glossary);
  }
  return lines.join("\n");
}

export function buildExplainWordPrompt(selection: string, paragraph: string): string {
  return [
    "任务：解释选中的词或短语在这篇论文语境中的意思。",
    "按下面四个小标题作答：",
    "1. 语境含义",
    "2. 词性",
    "3. 读音（容易给出时写 IPA 或拼音，否则写不确定）",
    "4. 例句（贴合所在段落的用法）",
    "",
    `选中：${selection}`,
    `所在段落：${paragraph || "（没有提供段落）"}`,
  ].join("\n");
}

export function buildExplainSentencePrompt(selection: string, paragraph: string): string {
  return [
    "任务：解释选中的句子。",
    "按下面三个小标题作答：",
    "1. 通俗含义",
    "2. 语法或逻辑结构",
    "3. 它在论证中的作用",
    "",
    `选中句子：${selection}`,
    `所在段落：${paragraph || "（没有提供段落）"}`,
  ].join("\n");
}

export function buildAskPrompt(question: string, selection: string, paragraph: string): string {
  return [
    "任务：回答用户关于选中文本的问题。选中文本和所在段落是上下文。",
    "",
    `问题：${question}`,
    `选中文本：${selection}`,
    `所在段落：${paragraph || "（没有提供段落）"}`,
  ].join("\n");
}
