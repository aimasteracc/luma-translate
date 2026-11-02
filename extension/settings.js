import { DEFAULTS, LANGUAGES, validateConfig } from "./core/config.js";
import { $, rpc, notice, fillLanguages } from "./ui.js";

let config = { ...DEFAULTS };
let hasKey = false;
let busy = false;
let dirty = false;

function paint(data) {
  config = data.config;
  hasKey = data.hasKey;
  for (const key of ["provider", "endpoint", "model", "style", "view", "glossary", "prompt"]) $(`#${key}`).value = config[key];
  fillLanguages($("#target"), LANGUAGES, config.target);
  $("#glossary-enabled").checked = config.glossaryEnabled;
  $("#endpoint-field").hidden = config.provider === "deepseek";
  $("#api-key").value = "";
  $("#api-key").placeholder = hasKey ? "保存済み（変更する場合だけ入力）" : "API キーを入力";
  $("#key-state").textContent = hasKey ? "登録済み · キーは画面へ読み戻しません" : "未登録";
  $("#remove-key").disabled = !hasKey;
  $("#origins").replaceChildren();
  if (!config.autoOrigins.length) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "まだ登録されていません。自動送信は行いません。";
    $("#origins").append(text);
  }
  for (const origin of config.autoOrigins) {
    const row = document.createElement("div");
    row.className = "saved-origin";
    const text = document.createElement("span");
    text.textContent = origin;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "解除";
    remove.setAttribute("aria-label", `${origin} の自動翻訳を解除`);
    remove.addEventListener("click", () => {
      config.autoOrigins = config.autoOrigins.filter(x => x !== origin);
      row.remove();
      dirty = true;
      notice("自動翻訳の解除は「設定を保存」で反映します。");
    });
    row.append(text, remove);
    $("#origins").append(row);
  }
  dirty = false;
}

function collect() {
  const next = { ...config };
  for (const key of ["provider", "endpoint", "model", "target", "style", "view", "glossary", "prompt"]) next[key] = $(`#${key}`).value;
  next.glossaryEnabled = $("#glossary-enabled").checked;
  return validateConfig(next);
}

async function save() {
  const next = collect();
  if (next.provider === "compatible") {
    const allowed = await chrome.permissions.request({ origins: [`${new URL(next.endpoint).origin}/*`] });
    if (!allowed) throw new Error("接続先 API へのアクセスが許可されませんでした。");
  }
  const entered = $("#api-key").value.trim();
  const data = await rpc("SAVE_SETTINGS", { config: next, ...(entered ? { apiKey: entered } : {}) });
  paint(data);
  return data;
}

async function run(action) {
  if (busy) return;
  busy = true;
  $("#save").disabled = true;
  $("#test").disabled = true;
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { busy = false; $("#save").disabled = false; $("#test").disabled = false; }
}

$("#settings-form").addEventListener("input", () => { dirty = true; });
$("#settings-form").addEventListener("submit", event => {
  event.preventDefault();
  run(async () => { await save(); notice("保存しました。ページ上の Luma から翻訳を始められます。"); });
});
$("#provider").addEventListener("change", event => {
  $("#endpoint-field").hidden = event.target.value === "deepseek";
  if (event.target.value === "deepseek") {
    $("#endpoint").value = DEFAULTS.endpoint;
    $("#model").value = DEFAULTS.model;
  }
});
$("#show-key").addEventListener("click", () => {
  const visible = $("#api-key").type === "password";
  $("#api-key").type = visible ? "text" : "password";
  $("#show-key").textContent = visible ? "隠す" : "表示";
  $("#show-key").setAttribute("aria-pressed", String(visible));
});
$("#test").addEventListener("click", () => run(async () => {
  if (!$("#settings-form").reportValidity()) return;
  const data = await save();
  if (!data.hasKey) throw new Error("API キーを入力してください。");
  notice("API に接続しています…");
  const result = await rpc("TEST_CONNECTION");
  notice(`接続できました。テスト訳文: ${result.text}`);
}));
$("#remove-key").addEventListener("click", () => run(async () => {
  const data = await rpc("SAVE_SETTINGS", { config: collect(), apiKey: "" });
  paint(data);
  notice("API キーを削除しました。翻訳はキーを登録するまで実行されません。");
}));
$("#clear-cache").addEventListener("click", () => run(async () => {
  await rpc("CLEAR_CACHE");
  notice("メモリ内の訳文キャッシュを消去しました。ページ上の訳文はそのままです。");
}));
window.addEventListener("beforeunload", event => {
  if (dirty) { event.preventDefault(); event.returnValue = ""; }
});
rpc("GET_SETTINGS").then(paint).catch(error => notice(error.message, true));
