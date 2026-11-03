import "./runtime.js";
import { providers } from "../providers/index.js";
import { promptPlugins } from "./plugins.js";

export function createBackgroundRuntime() {
  const runtime = new globalThis.LumaRuntime();
  for (const [id, provider] of Object.entries(providers)) {
    runtime.register({
      id: `provider-${id}`, name: provider.label, provides: [`provider.${id}`],
      description: "設定した API へ翻訳を送信します。",
      setup(ctx) { ctx.provide(`provider.${id}`, provider); },
    });
  }
  for (const plugin of promptPlugins) {
    runtime.register({
      id: plugin.id,
      name: plugin.id === "glossary" ? "用語辞書" : "カスタムプロンプト",
      description: "設定した翻訳ルールをリクエストに追加します。",
      setup(ctx) {
        ctx.on("translation:instructions", ({ config, instructions }) => {
          if (plugin.enabled(config)) instructions.push(plugin.instructions(config));
        });
      },
    });
  }
  runtime.configure();
  return runtime;
}
