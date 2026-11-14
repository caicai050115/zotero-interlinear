import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAskPrompt,
  buildExplainSentencePrompt,
  buildExplainWordPrompt,
  buildSelectionSystemPrompt,
  resolveAnswerLanguage,
} from "../src/selectionAssist.ts";

test("answer language follows a Chinese UI and otherwise the target language", () => {
  assert.equal(resolveAnswerLanguage("zh-CN", "en"), "简体中文");
  assert.equal(resolveAnswerLanguage("zh-TW", "en"), "繁体中文");
  assert.equal(resolveAnswerLanguage("en-US", "zh-CN"), "简体中文");
  assert.equal(resolveAnswerLanguage("en-US", "ja"), "日文");
  assert.equal(resolveAnswerLanguage("", undefined), "简体中文");
});

test("explain and ask prompts keep the selection and the paragraph", () => {
  const word = buildExplainWordPrompt("attention", "Attention is all you need.");
  assert.match(word, /语境含义/u);
  assert.match(word, /词性/u);
  assert.match(word, /读音/u);
  assert.match(word, /例句/u);
  assert.match(word, /选中：attention/u);
  assert.match(word, /所在段落：Attention is all you need\./u);

  const sentence = buildExplainSentencePrompt("Attention is all you need.", "The paragraph.");
  assert.match(sentence, /通俗含义/u);
  assert.match(sentence, /语法或逻辑/u);
  assert.match(sentence, /论证/u);

  const ask = buildAskPrompt("What does this contrast?", "however", "We expected X. however Y.");
  assert.match(ask, /问题：What does this contrast\?/u);
  assert.match(ask, /选中文本：however/u);

  const system = buildSelectionSystemPrompt("简体中文", "");
  assert.match(system, /简体中文/u);
  assert.match(system, /不要编造/u);
});
