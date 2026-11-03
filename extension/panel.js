import { LANGUAGES } from "./core/config.js";
import { providers } from "./providers/index.js";
import { $, rpc, notice, fillLanguages } from "./ui.js";

let tabId;
let origin;
let config;
let canTranslate = false;
let requestVersion = 0;
let currentState = { done: 0, total: 0 };

function paintSettings(data) {
  config = data.config;
  $("#setup-card").hidden = data.hasKey;
  fillLanguages($("#target"), LANGUAGES, config.target);
  $("#style").value = config.style;
  $("#glossary").checked = config.glossaryEnabled;
  $("#auto").checked = config.autoOrigins.includes(origin);
  const provider = providers[config.provider]?.label || config.provider;
  $("#provider-badge").textContent = provider;

  document.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view === config.view)));
  paintState(currentState);
}

function paintState(state) {
  currentState = state;
  if (state.origin) origin = state.origin;
  $("#auto").checked = config?.autoOrigins.includes(origin) || false;
  $("#auto").disabled = !origin || !/^https?:/.test(origin);
  const disabled = new Set(config?.disabledPlugins || []);
  const providerDisabled = disabled.has(`provider-${config?.provider}`);
  $("#translate").disabled = state.running || !canTranslate || providerDisabled || ["page", "renderer", "extractor"].some(id => disabled.has(id));
  $("#selection").disabled = state.running || !canTranslate || providerDisabled || disabled.has("selection");
  $("#cancel").hidden = !state.running;
  $("#progress-area").hidden = !state.total;
  $("#progress-label").textContent = state.running ? "翻訳しています…" : state.failed ? "一部の翻訳に失敗しました" : state.observing ? "翻訳済み・追加の本文を監視中" : "翻訳状況";
  $("#progress-count").textContent = `${state.done} / ${state.total}`;
  $("#progress").max = Math.max(1, state.total);
  $("#progress").value = state.done;
  $("#retry").hidden = !state.failed || state.running;
  notice(state.message || (canTranslate && ($("#translate").disabled || $("#selection").disabled) && !state.running
    ? "無効にした機能は「拡張機能」から再び有効にできます。" : ""), Boolean(state.failed));
}

async function refresh() {
  const version = ++requestVersion;
  canTranslate = false;
  $("#translate").disabled = true;
  $("#selection").disabled = true;
  $("#access-card").hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (version !== requestVersion) return;
    tabId = tab?.id;
    origin = /^https?:/.test(tab?.url || "") ? new URL(tab.url).origin : undefined;
    currentState = { done: 0, total: 0, origin };
    $("#access-card").hidden = true;
    canTranslate = false;
    const settings = await rpc("GET_SETTINGS");
    if (version !== requestVersion) return;
    paintSettings(settings);
    paintState({ done: 0, total: 0 });
    const state = await rpc("PAGE_COMMAND", { tabId, action: "state" });
    if (version !== requestVersion) return;
    canTranslate = true;
    paintState(state);
  } catch (error) {
    if (version === requestVersion) {
      $("#auto").disabled = true;
      $("#access-card").hidden = !origin;
      $("#access-origin").textContent = origin || "";
      notice(origin ? "このサイトへのアクセスを許可すると翻訳できます。" : error.message, true);
    }
  }
}

async function command(action) {
  try {
    const state = await rpc("PAGE_COMMAND", { tabId, action });
    paintState(state);
  } catch (error) { notice(error.message, true); }
}
async function preference(key, value) {
  try { paintSettings(await rpc("SET_PREFERENCE", { key, value })); }
  catch (error) { notice(error.message, true); }
}

for (const [id, action] of Object.entries({ translate: "translate", selection: "selection", cancel: "cancel", restore: "restore", retry: "retry" })) {
  $(`#${id}`).addEventListener("click", () => command(action));
}
$("#target").addEventListener("change", event => preference("target", event.target.value));
$("#style").addEventListener("change", event => preference("style", event.target.value));
$("#glossary").addEventListener("change", event => preference("glossaryEnabled", event.target.checked));
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => preference("view", button.dataset.view)));
document.querySelectorAll(".open-settings").forEach(button => button.addEventListener("click", () => chrome.runtime.openOptionsPage()));
async function loadPlugins() {
  const background = await rpc("GET_PLUGINS");
  let content = [];
  try { if (canTranslate) content = await rpc("PAGE_COMMAND", { tabId, action: "plugins" }); }
  catch (error) { $("#plugin-status").textContent = error.message; }
  $("#plugin-list").replaceChildren();
  for (const plugin of [...background, ...content]) {
    const row = document.createElement("section");
    row.className = "plugin-card";
    const label = document.createElement("label");
    label.className = "switch-row";
    const title = document.createElement("b");
    title.textContent = plugin.name;
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "switch";
    toggle.dataset.plugin = plugin.id;
    toggle.checked = plugin.enabled;
    toggle.setAttribute("aria-label", plugin.name);
    const detail = document.createElement("p");
    detail.textContent = plugin.description;
    const status = document.createElement("p");
    status.className = "hint";
    status.textContent = ({ active: "動作中", disabled: "無効", blocked: "依存機能が無効", error: "エラー" })[plugin.state] + (plugin.error ? ` · ${plugin.error}` : "");
    const metadata = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "開発者情報";
    const info = document.createElement("p");
    info.className = "hint";
    info.textContent = `${plugin.id} v${plugin.version} / services: ${plugin.provides.join(", ") || "-"} / dependencies: ${plugin.inject.join(", ") || "-"}`;
    metadata.append(summary, info);
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      $("#plugin-status").textContent = "変更中…";
      try {
        paintSettings(await rpc("SET_PLUGIN", { tabId, id: plugin.id, enabled: toggle.checked }));
        await loadPlugins();
        $("#plugin-status").textContent = "変更を反映しました。";
      } catch (error) { toggle.checked = !toggle.checked; $("#plugin-status").textContent = error.message; }
      finally { toggle.disabled = false; }
    });
    label.append(title, toggle);
    row.append(label, detail, status, metadata);
    $("#plugin-list").append(row);
  }
  if (!content.length) $("#plugin-status").textContent = "ページ側の機能は、翻訳対象のサイトを開いてアクセスを許可すると表示されます。";
}
$("#plugins").addEventListener("click", () => {
  $("#plugins-dialog").showModal();
  $("#plugin-status").textContent = "読み込み中…";
  loadPlugins().then(() => { if (canTranslate) $("#plugin-status").textContent = ""; }).catch(error => { $("#plugin-status").textContent = error.message; });
});
$("#grant-access").addEventListener("click", async () => {
  const requestedOrigin = origin;
  try {
    // The permission request must be the first async operation in the click handler.
    const allowed = await chrome.permissions.request({ origins: [`${requestedOrigin}/*`] });
    if (!allowed) throw new Error("アクセスは許可されませんでした。もう一度試すか、ツールバーの Luma アイコンから翻訳してください。");
    await refresh();
  } catch (error) { notice(error.message, true); }
});
$("#close-plugins").addEventListener("click", () => $("#plugins-dialog").close());
$("#auto").addEventListener("change", async event => {
  const enabled = event.target.checked;
  try {
    if (enabled) {
      const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!allowed) throw new Error("自動翻訳には、このサイトへのアクセス許可が必要です。");
    }
    paintSettings(await rpc("SET_AUTO", { origin, enabled }));
    notice(enabled ? "このサイトでは次回から自動翻訳します。" : "このサイトの自動翻訳を解除しました。");
  } catch (error) { event.target.checked = !enabled; notice(error.message, true); }
});
chrome.runtime.onMessage.addListener(message => {
  if (message.type === "LUMA_PANEL_STATUS" && message.tabId === tabId) paintState(message.state);
  if (message.type === "LUMA_PANEL_ERROR" && message.tabId === tabId) notice(message.error, true);
});
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === "complete") refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.config || changes.apiKey)) rpc("GET_SETTINGS").then(paintSettings).catch(() => {});
});
refresh();
