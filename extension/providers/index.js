import { buildMessages } from "../core/messages.js";

export class TranslationError extends Error {
  constructor(message, code = "API_ERROR") { super(message); this.code = code; }
}

export async function chatCompletion(text, config, apiKey, signal, fetcher = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  // End before the MV3 service worker's 30-second fetch-response deadline.
  const timer = setTimeout(abort, 25000);
  try {
    const body = {
      model: config.model,
      messages: buildMessages(text, config),
      stream: false,
      max_tokens: 4096,
    };
    if (config.provider === "deepseek") body.thinking = { type: "disabled" };
    const response = await fetcher(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      const messages = {
        400: "API の設定またはモデル名を確認してください。",
        401: "API キーが無効です。設定画面で確認してください。",
        402: "API の残高が不足しています。プロバイダーの残高を確認してください。",
        403: "この API へのアクセスが許可されていません。",
        404: "API の URL またはモデル名が見つかりません。",
        429: "API の利用制限に達しました。少し待ってから再試行してください。",
      };
      throw new TranslationError(messages[response.status] || `API が応答できませんでした（${response.status}）。時間をおいて再試行してください。`, `HTTP_${response.status}`);
    }
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") throw new TranslationError("訳文が長すぎて途中で切れました。短い範囲を選択して再試行してください。", "TRUNCATED");
    const result = choice?.message?.content;
    if (typeof result !== "string" || !result.trim()) throw new TranslationError("API から訳文が返りませんでした。モデル設定を確認してください。", "EMPTY");
    if (result.length > 40000) throw new TranslationError("API の応答が大きすぎます。", "OVERSIZED");
    return result.trim();
  } catch (error) {
    if (error instanceof TranslationError) throw error;
    if (signal?.aborted) throw new TranslationError("翻訳を中断しました。", "CANCELLED");
    if (controller.signal.aborted) throw new TranslationError("応答がタイムアウトしました。再試行してください。", "TIMEOUT");
    throw new TranslationError("API に接続できません。ネットワーク・URL・アクセス権限を確認してください。", "NETWORK");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// Register packaged providers here. Providers never receive a page DOM or storage access.
export const providers = Object.freeze({
  deepseek: { label: "DeepSeek", translate: chatCompletion },
  compatible: { label: "OpenAI 互換 API", translate: chatCompletion },
});
