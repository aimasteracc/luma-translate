import { DEFAULTS, validateConfig, cacheKey, splitText } from "./core/config.js";
import { providers, TranslationError } from "./providers/index.js";

const pending = new Map();
const cache = new Map();
let settingsQueue = Promise.resolve();
function mutateSettings(operation) {
  const result = settingsQueue.then(operation);
  settingsQueue = result.catch(() => {});
  return result;
}
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const isExtension = sender => sender.url?.startsWith(chrome.runtime.getURL(""));

async function readSettings() {
  await ready;
  const data = await chrome.storage.local.get(["config", "apiKey"]);
  return { config: validateConfig(data.config), apiKey: data.apiKey || "" };
}

function publicConfig(config, apiKey) {
  return { ...config, glossary: undefined, prompt: undefined, hasKey: Boolean(apiKey) };
}

async function initializeTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    throw new Error("このタブでツールバーの Luma アイコンを押してください。chrome://・拡張機能画面・PDF などの特殊ページは翻訳対象外です。");
  }
}

async function forward(tabId, action, data = {}) {
  if (!Number.isInteger(tabId)) throw new Error("翻訳するタブが見つかりません。");
  await initializeTab(tabId);
  return chrome.tabs.sendMessage(tabId, { type: "LUMA_COMMAND", action, ...data });
}

function cancel(owner) {
  for (const [id, task] of pending) if (task.owner === owner) {
    task.controller.abort();
    pending.delete(id);
  }
}

async function translate(text, owner) {
  if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("1 回の選択は 1〜20,000 文字にしてください。");
  const { config, apiKey } = await readSettings();
  if (!apiKey) throw new TranslationError("最初に設定画面で API キーを登録してください。", "NO_KEY");
  if ([...pending.values()].filter(x => x.owner === owner).length >= 2) throw new Error("翻訳中です。完了を待ってからお試しください。");
  const key = cacheKey(text, config);
  if (cache.has(key)) return { text: cache.get(key), cached: true };
  const controller = new AbortController();
  const id = crypto.randomUUID();
  pending.set(id, { owner, controller });
  try {
    const result = [];
    for (const part of splitText(text)) {
      if (controller.signal.aborted) throw new TranslationError("翻訳を中断しました。", "CANCELLED");
      result.push(await providers[config.provider].translate(part, config, apiKey, controller.signal));
    }
    const translated = result.join("\n");
    cache.set(key, translated);
    while (cache.size > 100) cache.delete(cache.keys().next().value);
    return { text: translated, cached: false };
  } finally { pending.delete(id); }
}

async function syncAutoScripts(config) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const own = existing.filter(x => x.id.startsWith("luma-auto-")).map(x => x.id);
  if (own.length) await chrome.scripting.unregisterContentScripts({ ids: own });
  const scripts = [];
  for (const [i, origin] of config.autoOrigins.entries()) {
    if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
      scripts.push({ id: `luma-auto-${i}`, matches: [`${origin}/*`], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true });
    }
  }
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

async function saveSettings(message) {
  const config = validateConfig(message.config);
  const previous = await readSettings();
  if (config.endpoint !== previous.config.endpoint && message.apiKey === undefined && previous.apiKey) {
    throw new Error("接続先を変更する場合は、その接続先の API キーを入力してください。");
  }
  const apiKey = message.apiKey === undefined ? previous.apiKey : message.apiKey;
  if (typeof apiKey !== "string" || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("API キーの形式を確認してください。");
  if (config.provider === "compatible" && !await chrome.permissions.contains({ origins: [`${new URL(config.endpoint).origin}/*`] })) {
    throw new Error("カスタム API へのアクセスを許可してください。");
  }
  const reset = cacheKey("", config) !== cacheKey("", previous.config) || apiKey.trim() !== previous.apiKey;
  if (reset) {
    for (const task of pending.values()) task.controller.abort();
    pending.clear();
    cache.clear();
  }
  await chrome.storage.local.set({ config, apiKey: apiKey.trim() });
  await syncAutoScripts(config);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "LUMA_CONFIG", config: publicConfig(config, apiKey), reset })));
  return { config, hasKey: Boolean(apiKey.trim()) };
}

async function handle(message, sender) {
  const owner = sender.tab?.id ?? `extension:${sender.url}`;
  if (message.type === "LUMA_PUBLIC_CONFIG") {
    const { config, apiKey } = await readSettings();
    return publicConfig(config, apiKey);
  }
  if (message.type === "LUMA_TRANSLATE") {
    if (!sender.tab || sender.frameId !== 0) throw new Error("翻訳はページ本文からのみ実行できます。");
    return translate(message.text, owner);
  }
  if (message.type === "LUMA_CANCEL") { cancel(owner); return {}; }
  if (message.type === "OPEN_SETTINGS") { await chrome.runtime.openOptionsPage(); return {}; }
  if (message.type === "LUMA_STATUS" && sender.tab) {
    chrome.runtime.sendMessage({ type: "LUMA_PANEL_STATUS", tabId: sender.tab.id, state: message.state }).catch(() => {});
    return {};
  }
  if (!isExtension(sender)) throw new Error("この操作は拡張機能の画面からのみ実行できます。");
  switch (message.type) {
    case "GET_SETTINGS": {
      const { config, apiKey } = await readSettings();
      return { config, hasKey: Boolean(apiKey) };
    }
    case "SAVE_SETTINGS": return mutateSettings(() => saveSettings(message));
    case "TEST_CONNECTION": {
      const result = await translate("Hello, world.", owner);
      return { text: result.text };
    }
    case "PAGE_COMMAND": return forward(message.tabId, message.action, message.data);
    case "SET_PREFERENCE": return mutateSettings(async () => {
      if (!["target", "style", "view", "glossaryEnabled"].includes(message.key)) throw new Error("無効な設定です。");
      const { config } = await readSettings();
      return saveSettings({ config: { ...config, [message.key]: message.value } });
    });
    case "SET_AUTO": return mutateSettings(async () => {
      const { config } = await readSettings();
      const origin = new URL(message.origin).origin;
      if (!/^https?:\/\//.test(origin)) throw new Error("このサイトには設定できません。");
      if (message.enabled && !await chrome.permissions.contains({ origins: [`${origin}/*`] })) throw new Error("このサイトへのアクセスを許可してください。");
      config.autoOrigins = config.autoOrigins.filter(x => x !== origin);
      if (message.enabled) config.autoOrigins.push(origin);
      return saveSettings({ config });
    });
    case "CLEAR_CACHE": cache.clear(); return {};
    default: throw new Error("不明な操作です。");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.type || message.type === "LUMA_PANEL_STATUS") return false;
  handle(message, sender).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message, code: error.code }));
  return true;
});

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  initializeTab(tab.id).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await ready;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "luma-selection", title: "選択範囲を Luma で翻訳", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "luma-page", title: "ページ全体を Luma で翻訳", contexts: ["page"] });
  });
  await syncAutoScripts((await readSettings()).config);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId.startsWith("luma-")) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  forward(tab.id, info.menuItemId === "luma-selection" ? "selection" : "translate", { text: info.selectionText }).catch(() => {});
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) forward(tab.id, command === "translate-page" ? "translate" : "selection").catch(() => {});
});

chrome.tabs.onRemoved.addListener(cancel);
chrome.permissions.onRemoved.addListener(async () => {
  await mutateSettings(async () => {
    const { config } = await readSettings();
    const allowed = await Promise.all(config.autoOrigins.map(origin => chrome.permissions.contains({ origins: [`${origin}/*`] })));
    config.autoOrigins = config.autoOrigins.filter((origin, i) => allowed[i]);
    await saveSettings({ config });
  });
});
