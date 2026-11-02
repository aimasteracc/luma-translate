import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm, readdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "test-results");
await mkdir(output, { recursive: true });
let mode = "success";
let requests = [];
const translations = {
  "Good tools help us stay focused on what matters.": "優れたツールは、大切なことへの集中を助けます。",
  "A quieter way to read the world.": "世界を、もっと自然に読む。",
  "Make room for new ideas.": "新しいアイデアのために、余白をつくろう。",
  "Hello, world.": "こんにちは、世界。",
};
const server = http.createServer(async (req, res) => {
  if (req.url === "/chat/completions") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const text = data.messages.at(-1).content;
    requests.push({ text, body: data, authorization: req.headers.authorization });
    const currentMode = mode;
    if (currentMode === "slow") await new Promise(resolve => setTimeout(resolve, 1400));
    res.setHeader("Content-Type", "application/json");
    if (currentMode === "unauthorized") { res.writeHead(401); res.end('{"error":"test-secret should not leak"}'); return; }
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: translations[text] || `訳文：${text}` } }] }));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(await readFile(path.join(root, "tests/fixture.html")));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(path.join(os.tmpdir(), "luma-browser-test-"));
const extension = path.join(temp, "extension");
await cp(path.join(root, "extension"), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json")));
// Only the disposable test copy receives the fixture origin permission.
manifest.host_permissions.push(`${origin}/*`);
await writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
let executablePath = process.env.CHROMIUM_PATH;
if (!executablePath && process.platform === "darwin") {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const versions = (await readdir(cache)).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const version of versions) {
    const candidate = path.join(cache, version, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
}
let context;
const results = [];
const passed = text => { results.push(text); console.log(`PASS ${text}`); };
try {
  context = await chromium.launchPersistentContext(path.join(temp, "profile"), {
    executablePath, channel: executablePath ? undefined : "chromium",
    headless: true, viewport: { width: 1240, height: 980 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.waitForFunction(() => document.querySelector("#key-state").textContent === "未登録");
  await settings.locator("#provider").selectOption("compatible");
  await settings.locator("#endpoint").fill(origin);
  await settings.locator("#model").fill("fixture-model");
  await settings.locator("#api-key").fill("test-secret");
  await settings.locator("#test").click();
  await settings.getByRole("status").filter({ hasText: "接続できました" }).waitFor();
  assert.equal(await settings.locator("#api-key").inputValue(), "");
  assert.equal(requests[0].authorization, "Bearer test-secret");
  passed("Settings UI saves credentials and connects through real worker/provider to local fixture API");
  await settings.evaluate(() => scrollTo(0, 0));
  await settings.screenshot({ path: path.join(output, "settings-desktop.png") });
  await settings.setViewportSize({ width: 390, height: 844 });
  assert.ok(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await settings.screenshot({ path: path.join(output, "settings-mobile.png"), fullPage: true });
  await settings.setViewportSize({ width: 1240, height: 980 });
  passed("Settings responsive layout at 390px has no horizontal overflow");
  const page = await context.newPage();
  await page.goto(origin);
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/`).id, origin);
  const command = async (action, data = {}) => {
    const result = await settings.evaluate(async ({ tabId, action, data }) => chrome.runtime.sendMessage({ type: "PAGE_COMMAND", tabId, action, data }), { tabId, action, data });
    assert.equal(result.ok, true, result.error);
    return result.data;
  };
  await command("translate");
  await page.waitForFunction(() => document.querySelector("#intro + [data-luma=translation]")?.shadowRoot?.textContent.includes("優れたツール"));
  await page.waitForFunction(() => document.querySelectorAll("[data-luma=translation]").length >= 10);
  for (let i = 0; i < 80; i++) {
    const state = await command("state");
    if (!state.running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const translatedState = await command("state");
  assert.equal(translatedState.failed, 0);
  assert.equal(translatedState.done, translatedState.total);
  assert.ok(translatedState.total > 10);
  assert.ok(requests.every(r => !r.text.includes("Do not translate code.") && !r.text.includes("Editable content") && !r.text.includes("Never send private") && !r.text.includes("protected text")));
  assert.equal(await page.locator("#code").textContent(), 'console.log("Do not translate code.");');
  assert.equal(await page.locator("#article-link").getAttribute("href"), "#details");
  await page.locator("#original-button").click();
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal(await page.locator("#markup img").count(), 0);
  assert.equal(await page.locator("tr > [data-luma=translation]").count(), 0);
  assert.equal(await page.locator("ul > [data-luma=translation]").count(), 0);
  passed("Whole-page translation preserves links, code, forms, table/list structure and event handlers");
  const publicConfig = await worker.evaluate(async tabId => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => ({ config: await chrome.runtime.sendMessage({ type: "LUMA_PUBLIC_CONFIG" }), storage: await chrome.storage.local.get().catch(error => error.message) }),
    });
    return results[0].result;
  }, tabId);
  assert.ok(!JSON.stringify(publicConfig).includes("test-secret"));
  passed("Content scripts cannot read API key from config messages or trusted storage");
  await page.screenshot({ path: path.join(output, "translated-page.png"), fullPage: true });
  const preference = async (key, value) => {
    const response = await settings.evaluate(async ({ key, value }) => chrome.runtime.sendMessage({ type: "SET_PREFERENCE", key, value }), { key, value });
    assert.equal(response.ok, true, response.error);
  };
  await preference("view", "translation");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#intro")).display === "none");
  assert.ok(await page.locator("#intro + [data-luma=translation]").isVisible());
  await preference("view", "bilingual");
  assert.ok(await page.locator("#intro").isVisible());
  passed("Translation-only and bilingual modes switch without losing original content");
  await page.evaluate(() => {
    const p = document.createElement("p"); p.id = "new-paragraph"; p.textContent = "Dynamically loaded article content."; document.querySelector("#dynamic").append(p);
  });
  await page.waitForFunction(() => document.querySelector("#new-paragraph + [data-luma=translation]"));
  await page.locator("#new-paragraph").evaluate(node => { node.textContent = "Updated article content."; });
  await page.waitForFunction(() => document.querySelector("#new-paragraph + [data-luma=translation]")?.shadowRoot.textContent.includes("Updated article"));
  passed("New and changed dynamic content translates without duplicate output");
  await command("selection", { text: "Make room for new ideas." });
  await page.locator("[data-luma=controls] .result").filter({ hasText: "新しいアイデア" }).waitFor();
  await page.locator("[data-luma=controls] .close").click();
  passed("Selection popup returns translation and closes");
  await command("restore");
  assert.equal(await page.locator("[data-luma=translation]").count(), 0);
  assert.ok(await page.locator("#intro").isVisible());
  await page.locator("#original-button").click();
  assert.equal(await page.evaluate(() => window.clicks), 2);
  passed("Restore removes translations and retains original interactivity");
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }));
  mode = "unauthorized";
  await command("translate");
  await page.waitForTimeout(300);
  const failure = await command("state");
  assert.ok(failure.failed > 0);
  assert.match(failure.message, /API キーが無効/);
  assert.ok(!failure.message.includes("test-secret"));
  mode = "success";
  await command("retry");
  await page.waitForFunction(() => document.querySelector("#intro + [data-luma=translation]"));
  for (let i = 0; i < 80; i++) {
    if (!(await command("state")).running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await command("state")).failed, 0);
  passed("Authentication failure halts queue; retry recovers all failed blocks without leaking response");
  await command("restore");
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }));
  mode = "slow";
  await command("translate");
  await page.waitForTimeout(150);
  await command("cancel");
  await page.waitForTimeout(1600);
  assert.equal(await page.locator("[data-luma=translation]").count(), 0);
  assert.equal((await command("state")).running, false);
  passed("Cancellation aborts in-flight work and prevents late DOM writes");
  mode = "success";
  await page.bringToFront();
  const auto = await settings.evaluate(async origin => chrome.runtime.sendMessage({ type: "SET_AUTO", origin, enabled: true }), origin);
  assert.equal(auto.ok, true, auto.error);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#intro + [data-luma=translation]"), { timeout: 10000 });
  passed("Opt-in site permission registers automatic translation on reload");
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.setViewportSize({ width: 390, height: 920 });
  // The standalone panel test tab itself cannot be translated; state from the real article is sent normally.
  await page.bringToFront();
  await command("state");
  await panel.waitForTimeout(100);
  await panel.screenshot({ path: path.join(output, "panel.png") });
  assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.getByRole("button", { name: "拡張機能", exact: true }).click();
  await panel.locator("#plugins-dialog").waitFor({ state: "visible" });
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  passed("Panel layout and plugin settings dialog work at 390px");
  await settings.reload();
  assert.equal(await settings.locator("#api-key").inputValue(), "");
  await settings.locator("#remove-key").click();
  await settings.getByRole("status").filter({ hasText: "API キーを削除しました" }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("apiKey"))).apiKey, "");
  passed("Saved API key can be deleted without exposing its value");
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify({ date: new Date().toISOString(), tests: results, fixtureOnly: true, realDeepSeekTested: false }, null, 2));
} catch (error) {
  if (context) {
    for (const [i, page] of context.pages().entries()) await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
