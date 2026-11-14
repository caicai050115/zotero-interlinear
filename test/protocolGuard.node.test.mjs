import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  removeUnsafeProtocolHandlers,
  UNSAFE_TOOLKIT_PROTOCOL_KEYS,
} from "../src/protocolGuard.ts";

const read = (url) => readFileSync(new URL(url, import.meta.url), "utf8");

test("disarm deletes the install and code-execution protocol keys", () => {
  const extensions = {
    "zotero://select": { keep: true },
    [UNSAFE_TOOLKIT_PROTOCOL_KEYS[0]]: { install: true },
    [UNSAFE_TOOLKIT_PROTOCOL_KEYS[1]]: { run: true },
  };
  const removed = removeUnsafeProtocolHandlers(extensions);
  assert.deepEqual(removed.sort(), [...UNSAFE_TOOLKIT_PROTOCOL_KEYS].sort());
  assert.deepEqual(Object.keys(extensions), ["zotero://select"]);
  assert.deepEqual(removeUnsafeProtocolHandlers(extensions), []);
  assert.deepEqual(removeUnsafeProtocolHandlers(null), []);
});

test("the keys are the toolkit install and debug-bridge handlers", () => {
  assert.deepEqual(
    [...UNSAFE_TOOLKIT_PROTOCOL_KEYS],
    ["zotero://" + "plugin", "zotero://" + "ztoolkit-debug"],
  );
});

test("this plugin does not construct the toolkit bridges", () => {
  const ztoolkit = read("../src/utils/ztoolkit.ts");
  const hooks = read("../src/hooks.ts");
  const pkg = JSON.parse(read("../package.json"));
  assert.match(ztoolkit, /zotero-plugin-toolkit\/ztoolkit/);
  assert.doesNotMatch(ztoolkit, /DebugBridge\.register|basicOptions\.debug/);
  assert.match(hooks, /disarmToolkitProtocolHandlers/);
  assert.equal(pkg.dependencies["zotero-plugin-toolkit"], "6.0.0");

  const toolkitEntry = read("../node_modules/zotero-plugin-toolkit/dist/ztoolkit.js");
  assert.doesNotMatch(toolkitEntry, /zotero:\/\/plugin|getInstallForURL|DebugBridge/);

  const builtUrl = new URL(
    "../.scaffold/build/addon/content/scripts/interlinear.js",
    import.meta.url,
  );
  let built = "";
  try {
    built = readFileSync(builtUrl, "utf8");
  } catch {
    return;
  }
  assert.doesNotMatch(built, /getInstallForURL/);
  assert.doesNotMatch(built, /zotero:\/\/plugin\/\?action=install/);
  assert.doesNotMatch(built, /zotero:\/\/ztoolkit-debug\/\?run=/);
  assert.doesNotMatch(built, /DebugBridge\.register/);
});
