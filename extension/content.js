(() => {
  if (globalThis.__lumaTranslate) return;
  globalThis.__lumaTranslate = true;
  const IGNORE = "script,style,noscript,template,pre,code,kbd,samp,textarea,input,select,button,svg,math,canvas,iframe,[contenteditable]:not([contenteditable=false]),[translate=no],.notranslate,[data-luma]";
  const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,blockquote,dt,dd,div,section,article";
  const records = new Map();
  const runtime = new globalThis.LumaRuntime();
  let config = {};
  let generation = 0;
  let queue = [];
  let active = 0;
  let watching = false;
  let scheduled;
  let selectionText = "";
  let selectionGeneration = 0;
  const state = { running: false, done: 0, total: 0, failed: 0, message: "", observing: false, origin: location.origin };

  const host = document.createElement("div");
  host.dataset.luma = "controls";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{color-scheme:light} *{box-sizing:border-box} [hidden]{display:none!important}
      .chip,.card{font:14px/1.65 "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;color:#183d37;pointer-events:auto}
      button{font:inherit;cursor:pointer;min-height:40px;border:1px solid #cddbd5;border-radius:9px;background:#fff;color:#174b43;padding:7px 13px}
      button:hover{background:#edf5f0} button:focus-visible{outline:3px solid #ad6b24;outline-offset:3px}
      .chip{position:fixed;background:#124d43;color:#fff;border-color:#124d43;box-shadow:0 5px 24px #163e3526}
      .chip:hover{background:#226657}
      .card{position:fixed;right:22px;bottom:22px;width:min(390px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#fffdf8;border:1px solid #d7dfd7;border-radius:16px;box-shadow:0 16px 60px #193d3529;padding:22px}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
      h2{font:600 20px Georgia,serif;margin:0} .close{border:0;background:transparent;font-size:22px;padding:0 10px}
      .label{font-size:11px;letter-spacing:.07em;color:#60726b;margin:12px 0 4px}
      .source{color:#60726b;white-space:pre-wrap;max-height:120px;overflow:auto;font-size:13px}
      .result{font-size:16px;white-space:pre-wrap;overflow-wrap:anywhere;min-height:60px}
      footer{display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #e1e7df;margin-top:18px;padding-top:12px}
      .error{color:#a33026} .hint{font-size:12px;color:#60726b}
    </style>
    <button class="chip" hidden aria-label="選択範囲を翻訳">選択範囲を翻訳</button>
    <section class="card" role="dialog" aria-label="選択範囲の翻訳" hidden>
      <header><h2>Luma Translate</h2><button class="close" aria-label="閉じる">×</button></header>
      <div class="label">原文</div><div class="source"></div>
      <div class="label target-label">訳文</div><div class="result" role="status" aria-live="polite"></div>
      <footer><button class="copy">コピー</button><button class="retry">再翻訳</button><button class="settings">設定</button></footer>
      <p class="hint">選択した文章を設定済みの翻訳 API に送信します。</p>
    </section>`;
  document.documentElement.append(host);
  const $ = selector => shadow.querySelector(selector);
  const chip = $(".chip");
  const card = $(".card");
  let returnFocus;

  async function rpc(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...data });
    if (!result?.ok) {
      const error = new Error(result?.error || "拡張機能との接続が切れました。ページを再読み込みしてください。");
      error.code = result?.code;
      throw error;
    }
    return result.data;
  }

  function report() {
    state.running = active > 0 || queue.length > 0;
    state.observing = watching;
    chrome.runtime.sendMessage({ type: "LUMA_STATUS", state: { ...state } }).catch(() => {});
  }

  function sourceText(node) { return (node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent)?.trim() || ""; }
  function readable(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(IGNORE) || !/\p{L}/u.test(node.nodeValue || "")) return false;
    if (parent.closest("[hidden],[aria-hidden=true]")) return false;
    const style = getComputedStyle(parent);
    return style.visibility !== "hidden" && style.display !== "none" && parent.getClientRects().length > 0;
  }

  async function collect() {
    const token = generation;
    let visited = 0;
    const found = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (++visited % 300 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (token !== generation) return [];
      }
      const node = walker.currentNode;
      if (!readable(node)) continue;
      const block = node.parentElement.closest(BLOCKS);
      const safeBlock = block && !block.matches("body,td,th,li,dt,dd") && !block.querySelector(`${BLOCKS},${IGNORE}`);
      const source = safeBlock ? block : node;
      if (sourceText(source).length < 2) continue;
      if (sourceText(source).length > 20000) continue;
      found.add(source);
    }
    return [...found];
  }

  function showOriginal(record) {
    if (record.wrapper) {
      record.wrapper.replaceWith(record.source);
      record.wrapper = null;
    }
    if (record.hidden) {
      if (record.display) record.source.style.setProperty("display", record.display, record.priority);
      else record.source.style.removeProperty("display");
      record.hidden = false;
    }
  }

  function applyView(record) {
    showOriginal(record);
    if (!record.output || config.view !== "translation") return;
    if (record.source.nodeType === Node.TEXT_NODE) {
      const wrapper = document.createElement("span");
      wrapper.dataset.luma = "original";
      wrapper.style.setProperty("display", "none", "important");
      record.source.replaceWith(wrapper);
      wrapper.append(record.source);
      record.wrapper = wrapper;
    } else {
      record.display = record.source.style.getPropertyValue("display");
      record.priority = record.source.style.getPropertyPriority("display");
      record.source.style.setProperty("display", "none", "important");
      record.hidden = true;
    }
  }

  function render(record, text) {
    if (!record.source.isConnected || sourceText(record.source) !== record.original) return false;
    record.output?.remove();
    const output = document.createElement("span");
    output.dataset.luma = "translation";
    output.setAttribute("lang", ({ 日本語: "ja", 简体中文: "zh-CN", 繁體中文: "zh-TW", English: "en", 한국어: "ko", Deutsch: "de", Français: "fr", Español: "es" })[config.target] || "ja");
    const inline = record.source.nodeType === Node.TEXT_NODE;
    output.style.cssText = inline ? "display:inline!important;margin:0 4px!important" : "display:block!important;margin:8px 0 16px!important;clear:none!important";
    const root = output.attachShadow({ mode: "open" });
    const box = document.createElement("div");
    box.style.cssText = 'color:#153f36;background:#eef5ef;border-left:3px solid #287465;padding:10px 14px;font:400 16px/1.8 "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;text-align:start;color-scheme:light';
    if (inline) box.style.cssText = "display:inline;color:#153f36;background:#eef5ef;padding:1px 4px;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere";
    box.textContent = text;
    root.append(box);
    record.source.after(output);
    record.output = output;
    record.status = "done";
    applyView(record);
    return true;
  }

  function enqueue(sources) {
    for (const source of sources) {
      if (records.has(source)) continue;
      if (records.size >= 500) {
        state.message = "このページは 500 箇所まで翻訳しました。残りは範囲を選択して翻訳できます。";
        break;
      }
      const record = { source, original: sourceText(source), status: "queued" };
      records.set(source, record);
      queue.push(record);
      state.total++;
    }
    pump();
  }

  function pump() {
    const token = generation;
    while (active < 2 && queue.length) {
      const record = queue.shift();
      if (!record.source.isConnected) { records.delete(record.source); state.total--; continue; }
      active++;
      record.status = "pending";
      rpc("LUMA_TRANSLATE", { text: record.original }).then(result => {
        if (token !== generation) return;
        if (runtime.get("renderer").render(record, result.text)) state.done++;
        else { records.delete(record.source); state.total--; }
      }).catch(error => {
        if (token !== generation) return;
        record.status = "failed";
        state.failed++;
        state.message = error.message;
        if (["NO_KEY", "HTTP_401", "HTTP_402", "HTTP_403", "HTTP_404", "HTTP_429"].includes(error.code)) {
          for (const queued of queue) { queued.status = "failed"; state.failed++; }
          queue = [];
          watching = false;
        }
      }).finally(() => {
        if (token !== generation) return;
        active--;
        pump();
      });
    }
    report();
  }

  async function stop() {
    generation++;
    watching = false;
    queue = [];
    active = 0;
    clearTimeout(scheduled);
    for (const record of records.values()) if (["pending", "queued"].includes(record.status)) record.status = "cancelled";
    report();
    await rpc("LUMA_CANCEL");
  }

  async function restore() {
    const stopped = stop();
    selectionGeneration++;
    card.hidden = true;
    chip.hidden = true;
    for (const record of records.values()) {
      showOriginal(record);
      record.output?.remove();
    }
    records.clear();
    Object.assign(state, { done: 0, total: 0, failed: 0, message: "" });
    report();
    await stopped;
  }

  async function start(retry = false) {
    if (!config.hasKey) { state.message = "設定画面で API キーを登録してください。"; report(); return; }
    if (state.running) return;
    if (!card.hidden) {
      selectionGeneration++;
      card.hidden = true;
      await rpc("LUMA_CANCEL");
    }
    state.message = "";
    watching = runtime.plugins.get("dynamic")?.state === "active";
    for (const [source, record] of records) {
      if (record.status === "cancelled" || (retry && record.status === "failed")) {
        records.delete(source);
        state.total--;
        if (record.status === "failed") state.failed--;
      }
    }
    enqueue(await runtime.get("extractor").collect());
    if (!state.total) { state.message = "翻訳できる本文が見つかりませんでした。範囲選択をお試しください。"; report(); }
  }

  const observer = new MutationObserver(() => {
    if (!watching) return;
    clearTimeout(scheduled);
    scheduled = setTimeout(async () => {
      for (const [source, record] of records) {
        if (record.status === "pending" || record.status === "queued") continue;
        if (!source.isConnected || sourceText(source) !== record.original) {
          showOriginal(record);
          record.output?.remove();
          records.delete(source);
          state.total--;
          if (record.status === "done") state.done--;
          if (record.status === "failed") state.failed--;
        }
      }
      enqueue(await runtime.get("extractor").collect());
    }, 600);
  });


  async function showSelection(text, { fresh = false } = {}) {
    if (!text?.trim()) {
      state.message = "先にページ上の文章を選択してください。";
      report();
      return;
    }
    const token = ++selectionGeneration;
    if (state.running || watching) await stop();
    else if (!card.hidden) await rpc("LUMA_CANCEL");
    if (token !== selectionGeneration) return;
    selectionText = text.trim();
    returnFocus = document.activeElement;
    chip.hidden = true;
    card.hidden = false;
    $(".source").textContent = selectionText;
    $(".target-label").textContent = `訳文（${config.target || "日本語"}）`;
    $(".result").textContent = "翻訳しています…";
    $(".result").classList.remove("error");
    $(".copy").disabled = true;
    $(".retry").disabled = true;
    $(".close").focus({ preventScroll: true });
    try {
      const result = await rpc("LUMA_TRANSLATE", { text: selectionText, fresh });
      if (token !== selectionGeneration) return;
      $(".result").textContent = result.text;
      $(".copy").disabled = false;
    } catch (error) {
      if (token !== selectionGeneration) return;
      $(".result").textContent = error.message;
      $(".result").classList.add("error");
    } finally {
      if (token === selectionGeneration) $(".retry").disabled = false;
    }
  }

  function closeSelection() {
    selectionGeneration++;
    card.hidden = true;
    rpc("LUMA_CANCEL").catch(() => {});
    returnFocus?.focus?.({ preventScroll: true });
  }
  runtime.register({
    id: "extractor", name: "本文抽出", provides: ["extractor"],
    description: "コード・入力欄を除外し、ページ本文を読み取ります。",
    setup(ctx) { ctx.provide("extractor", { collect }); },
  }).register({
    id: "renderer", name: "対訳表示", provides: ["renderer"],
    description: "原文を保持して訳文を表示します。停止時は原文へ戻します。",
    setup(ctx) {
      ctx.provide("renderer", { render });
      return () => { restore().catch(() => {}); };
    },
  }).register({
    id: "page", name: "ページ翻訳", inject: ["extractor", "renderer"], provides: ["page"],
    description: "全文の翻訳・中断・失敗箇所の再試行を行います。",
    setup(ctx) {
      ctx.provide("page", { start });
      return () => { stop().catch(() => {}); };
    },
  }).register({
    id: "dynamic", name: "追加の本文を翻訳", inject: ["page"],
    description: "スクロールや画面更新で追加された本文も翻訳します。",
    setup(ctx) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      return () => { observer.disconnect(); clearTimeout(scheduled); watching = false; report(); };
    },
  }).register({
    id: "selection", name: "選択範囲の翻訳", provides: ["selection"],
    description: "選択した文章をポップアップで翻訳・コピーできます。",
    setup(ctx) {
      ctx.provide("selection", { show: showSelection });
      ctx.effect(() => {
        selectionGeneration++;
        selectionText = "";
        chip.hidden = true;
        card.hidden = true;
        rpc("LUMA_CANCEL").catch(() => {});
      });
  ctx.listen($(".close"), "click", closeSelection);
  ctx.listen($(".retry"), "click", () => showSelection(selectionText, { fresh: true }));
  ctx.listen($(".copy"), "click", async () => {
    try {
      await navigator.clipboard.writeText($(".result").textContent);
      $(".copy").textContent = "コピーしました";
      setTimeout(() => { $(".copy").textContent = "コピー"; }, 1600);
    } catch { $(".copy").textContent = "訳文を選択してコピー"; }
  });
  ctx.listen($(".settings"), "click", () => chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" }));
  ctx.listen(chip, "pointerdown", event => event.preventDefault());
  ctx.listen(chip, "click", () => showSelection(selectionText));
  ctx.listen(document, "mouseup", event => {
    if (event.composedPath().includes(host)) return;
    setTimeout(() => {
      if (runtime.plugins.get("selection")?.state !== "active") return;
      const selection = window.getSelection();
      const parent = selection?.anchorNode?.parentElement;
      const text = selection?.toString().trim();
      if (!text || !parent || parent.closest(IGNORE) || !selection.rangeCount) { chip.hidden = true; return; }
      selectionText = text;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      chip.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - 185))}px`;
      chip.style.top = `${Math.min(Math.max(8, rect.bottom + 8), Math.max(8, innerHeight - 55))}px`;
      chip.hidden = false;
    }, 0);
  });
  ctx.listen(document, "keydown", event => {
    if (event.key === "Escape") { chip.hidden = true; if (!card.hidden) closeSelection(); }
  });
  ctx.listen(document, "scroll", () => { chip.hidden = true; }, { passive: true });
  ctx.listen(document, "selectionchange", () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    const parent = selection?.anchorNode?.parentElement;
    if (text && parent && !parent.closest(IGNORE)) selectionText = text;
  });

    },
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "LUMA_CONFIG") {
      const previous = config;
      config = message.config;
      runtime.configure(config.disabledPlugins);
      if (message.reset) restore().catch(() => {});
      else if (previous.view !== config.view) {
        for (const record of records.values()) applyView(record);
      }
      respond({ ...state });
      return;
    }
    if (message.type !== "LUMA_COMMAND") return;
    (async () => {
      await configReady;
      switch (message.action) {
        case "translate": await runtime.get("page").start(); break;
        case "retry": await runtime.get("page").start(true); break;
        case "cancel": await stop(); state.message = "中断しました。翻訳済みの箇所は残しています。"; break;
        case "restore": await restore(); break;
        case "selection": runtime.get("selection").show(message.text || window.getSelection()?.toString().trim() || selectionText); break;
        case "plugins": return runtime.list();
        case "state": break;
        default: throw new Error("不明な操作です。");
      }
      report();
      return { ...state };
    })().then(respond, error => respond({ ...state, message: error.message }));
    return true;
  });

  const configReady = rpc("LUMA_PUBLIC_CONFIG").then(value => {
    config = value;
    runtime.configure(config.disabledPlugins);
    if (config.autoOrigins?.includes(location.origin) && config.hasKey && runtime.plugins.get("page")?.state === "active") start().catch(error => { state.message = error.message; report(); });
  }).catch(error => { state.message = error.message; report(); });
})();
