export const $ = selector => document.querySelector(selector);
export async function rpc(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || "接続できませんでした。拡張機能を開き直してください。");
  return result.data;
}
export function notice(message = "", error = false) {
  const node = $("#status");
  node.textContent = message;
  node.classList.toggle("error", error);
}
export function fillLanguages(select, languages, value) {
  select.replaceChildren(...languages.map(text => {
    const option = document.createElement("option");
    option.value = text;
    option.textContent = text;
    return option;
  }));
  select.value = value;
}
