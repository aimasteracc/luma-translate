# 機能・Plugin 設計の再評価

2026-11-02。ユーザーからの実利用の指摘を受けた再調査。

## 2026-11-03 更新: v0.2.0

以下の v0.1.0 の評価は履歴として保持する。v0.2.0 ではサービス・依存解決・
イベント・可逆的な効果を持つ独自 Runtime と実際のプラグイン管理を実装した。
権限回復 UI、未許可ホストからの検証、辞書・選択・描画のライフサイクル検証も追加。
現行の実装契約は [EXTENDING.md](EXTENDING.md)、検証範囲は [QA.md](QA.md)。
独立スケジューラー、サイトアダプター、実 DeepSeek 疎通は未完了であり、
下記の元の構想をすべて完了したという意味ではない。

参照・導入した GitHub skills:
- GoogleChrome/modern-web-guidance: skills/chrome-extensions
- anthropics/skills: skills/webapp-testing
- 既存の ui-ux-pro-max は承認済みのデザインを維持するために使用。

## v0.1.0 についての訂正

v0.1.0 は、DeepSeek Harness 型の Plugin Runtime を実装していない。
`core/plugins.js` はプロンプト文字列を組み立てる固定配列、
`providers/index.js` は翻訳関数の固定レジストリである。

機能ごとのロード / アンロード、サービスの依存解決、登録の解除、
実行中タスクのライフサイクル、機能追加で拡張される管理画面がない。
全文翻訳・選択翻訳・描画・監視は `content.js` に固定されている。
「プラグイン中心の構造」という説明には不足があった。

DeepSeek Harness の公式 architecture / Cordis primer では、共有 Context に
サービス・イベント・可逆的な登録を提供し、依存サービスを inject で宣言する。
機能の有効化・無効化と、解除時の後片付けまでが設計の一部である。

調査した一次資料:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md

## 再現した不具合

### 接続確認が API に到達しない

1. 接続確認を成功させる。
2. 同じ接続先の API を 401 に切り替える。
3. 接続確認を再実行する。

旧実装はキャッシュされた「こんにちは、世界。」を返し、「接続できました」
と表示した。ブラウザテストでこの誤表示を再現した。

原因: `TEST_CONNECTION` が通常の翻訳キャッシュを使用していた。
修正: 接続確認は必ずキャッシュを迂回し、実際の API 応答を確認する。

### 選択範囲が失われる

1. 本文を選択し、選択翻訳ボタンが出ることを確認する。
2. フォーカス移動等でページの現在の Selection を解除する。
3. パネルから選択翻訳を指示する。

旧実装は選択翻訳ポップアップを表示できなかった。ブラウザテストで再現した。

原因: 選択を保持する `selectionText` は存在するが、パネルの命令処理が
`window.getSelection()` だけを参照していた。
修正: 現在の選択が失われた場合は保持済みの文章を使い、キーボードによる
選択変更も `selectionchange` で保持する。

### 再翻訳が新しい API リクエストを送らない

原因: ポップアップの「再翻訳」が通常のキャッシュ参照と同じ呼び出しだった。
修正: 明示的な再翻訳はキャッシュを迂回する。
テストで再翻訳の前後に API リクエスト数が増えることを確認する。

## 前回の検証の不足

- テスト用 manifest に翻訳対象の host permission を事前付与していた。
- 全文・選択翻訳を、パネルのクリックではなく内部メッセージで呼んでいた。
- ローカル API の正常応答を主に使い、実際の DeepSeek 疎通をしていない。
- 外部サイトでの読みやすさ、抽出の適切さ、速度を測っていない。
- テストの合格数を、実用性の保証に使うべきではなかった。

この時点では上記3不具合だけを修正した。追加の自主監査で権限・UI・
Plugin の問題を調査し、v0.2.0 へ進めた。現行の残課題は QA.md に記載。

## Plugin 中心へ再設計する場合の具体案

以下は v0.1.0 時点の設計案。現行との差分は上記と EXTENDING.md を参照。

### ホストの責務

ホストはプラグインの登録、依存サービスの解決、イベント配送、
設定の読み込み、ライフサイクル管理だけを持つ。
全文翻訳・選択翻訳をホスト内部の分岐に追加していく構造にしない。

ブラウザ拡張の privileged service worker とページ内 content script の
権限境界は維持する。API キーは background 側にのみ置く。

### 必要なプラグインと置き換え口

| Plugin | 提供するサービス | 無効化時に解除するもの |
| --- | --- | --- |
| DeepSeek provider | `translation.provider` | 実行中の API 呼び出し |
| Compatible provider | 同じ provider インターフェース | 実行中の API 呼び出し |
| Translation scheduler | `translation.jobs` | キュー、タイマー、進捗通知 |
| DOM extractor | `page.extractor` | 保持しているページ参照 |
| Inline renderer | `page.renderer` | 挿入訳文と原文への一時変更 |
| Full-page command | 全文翻訳コマンド | コマンド登録と開始したタスク |
| Selection command | 選択翻訳コマンド・ポップアップ | 選択イベント、UI、タスク |
| Dynamic page watcher | DOM 変更イベント | MutationObserver、タイマー |
| Glossary | 翻訳前の指示フック | フック登録 |
| Custom prompt | 翻訳前の指示フック | フック登録 |
| Site adapter | 特定サイトの抽出ルール | ルール登録 |

### 管理画面に必要なもの

現在の静的な説明ダイアログを、Runtime の実状態から描画する管理画面へ変更する。
各 Plugin の ID、バージョン、提供サービス、依存関係、有効 / 無効、
起動失敗理由、設定を表示する。有効化に失敗したものを「有効」と表示しない。

最初は同梱プラグインを対象にする。Harness の Node.js プラグインを
ブラウザ内でそのまま動かせるという互換性は約束しない。
リモート JavaScript のダウンロード実行を拡張方法にしない。

### 完成判定

1. 追加の翻訳 Provider をコア編集なしで登録し、同じ翻訳 UI で使用できる。
2. 用語辞書の無効化が、実際の API リクエストからその指示を除く。
3. 選択翻訳の無効化で、イベント・ポップアップ・実行中タスクが解除される。
4. 描画 Plugin を外すと、原文 DOM が復元される。
5. 必須サービスがない Plugin は開始されず、管理画面に理由が出る。
6. Plugin の再有効化で二重のイベント登録や二重翻訳が起きない。
7. 新しいサイトアダプターを追加しても、他サイトの抽出に影響しない。
8. 通常のブラウザ操作、実際の DeepSeek、ユーザー指定の実サイトで
   全文・選択翻訳を確認する。ローカル API テストだけで完成扱いにしない。
