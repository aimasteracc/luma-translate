import { LANGUAGES } from "./core/config.js";
import { $, rpc, notice, fillLanguages } from "./ui.js";

let tabId;
let origin;
let config;
let canTranslate = false;
let requestVersion = 0;

function paintSettings(data) {
  config = data.config;
  $("#setup-card").hidden = data.hasKey;
  fillLanguages($("#target"), LANGUAGES, config.target);
  $("#style").value = config.style;
  $("#glossary").checked = config.glossaryEnabled;
  $("#auto").checked = config.autoOrigins.includes(origin);
  const provider = config.provider === "deepseek" ? "DeepSeek" : "カスタム API";
  $("#provider-badge").textContent = provider;
  $("#plugin-provider").textContent = provider;
  $("#plugin-glossary").textContent = config.glossaryEnabled ? "有効" : "無効";
  document.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view === config.view)));
}

function paintState(state) {
  if (state.origin) origin = state.origin;
  $("#auto").checked = config?.autoOrigins.includes(origin) || false;
  $("#auto").disabled = !origin || !/^https?:/.test(origin);
  $("#translate").disabled = state.running || !canTranslate;
  $("#selection").disabled = state.running || !canTranslate;
  $("#cancel").hidden = !state.running;
  $("#progress-area").hidden = !state.total;
  $("#progress-label").textContent = state.running ? "翻訳しています…" : state.failed ? "一部の翻訳に失敗しました" : state.observing ? "翻訳済み・追加の本文を監視中" : "翻訳状況";
  $("#progress-count").textContent = `${state.done} / ${state.total}`;
  $("#progress").max = Math.max(1, state.total);
  $("#progress").value = state.done;
  $("#retry").hidden = !state.failed || state.running;
  notice(state.message, Boolean(state.failed));
}

async function refresh() {
  const version = ++requestVersion;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    origin = undefined;
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
      notice(error.message, true);
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
$("#plugins").addEventListener("click", () => $("#plugins-dialog").showModal());
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
});
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === "complete") refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.config || changes.apiKey)) rpc("GET_SETTINGS").then(paintSettings).catch(() => {});
});
refresh();
