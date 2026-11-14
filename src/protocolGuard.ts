// SPDX-License-Identifier: AGPL-3.0-or-later
// Interlinear — drop zotero-plugin-toolkit protocol handlers.
//
// Toolkit 5.1.0-beta.13 (used through Interlinear 0.8.1) registers two
// `zotero://` extensions as a side effect of `new ZoteroToolkit()`. That
// constructor builds PromptManager, which initializes ToolkitGlobal, which
// constructs DebugBridge and PluginBridge:
//
// - `zotero://plugin/?action=install&url=...` calls AddonManager.install()
//   with no confirmation dialog, so a web page can install an add-on.
// - `zotero://ztoolkit-debug/?run=...` evaluates the `run` parameter as a
//   script after window.confirm (or with no prompt when the debug-bridge
//   password check is disabled).
//
// This plugin never invoked those bridges. Constructing the toolkit was
// enough to publish them. Toolkit 6 removes PluginBridge and does not
// register DebugBridge unless DebugBridge.register() is called. We do not
// call it. disarmToolkitProtocolHandlers() still deletes both keys so a
// previous build of this plugin cannot leave them installed in-process.

const INSTALL_KEY = "zotero://" + "plugin";
const DEBUG_KEY = "zotero://" + "ztoolkit-debug";

export const UNSAFE_TOOLKIT_PROTOCOL_KEYS = [INSTALL_KEY, DEBUG_KEY] as const;

export function removeUnsafeProtocolHandlers(
  extensions: Record<string, unknown> | null | undefined,
): string[] {
  if (!extensions) return [];
  const removed: string[] = [];
  for (const key of UNSAFE_TOOLKIT_PROTOCOL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(extensions, key)) {
      delete extensions[key];
      removed.push(key);
    }
  }
  return removed;
}

/** Best-effort removal. Safe to call before Zotero finishes starting. */
export function disarmToolkitProtocolHandlers(): string[] {
  try {
    const services = (globalThis as { Services?: ProtocolServices }).Services;
    const extensions = services?.io?.getProtocolHandler?.("zotero")?.wrappedJSObject
      ?._extensions;
    return removeUnsafeProtocolHandlers(extensions);
  } catch {
    return [];
  }
}

interface ProtocolServices {
  io?: {
    getProtocolHandler?: (scheme: string) => {
      wrappedJSObject?: { _extensions?: Record<string, unknown> };
    };
  };
}
