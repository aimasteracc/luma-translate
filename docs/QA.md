# 検証記録

実施日: 2026-11-02（Asia/Tokyo）

## 合格

`npm test`: 9 件。

- 設定と API URL の検証。
- 翻訳条件を反映したキャッシュキー。
- Unicode を壊さない文章分割。
- 原文とシステム指示の分離。
- DeepSeek 用リクエストのモデル・認証・thinking 設定。
- 互換 API に DeepSeek 固有設定を送らないこと。
- API エラーの安全な表示。
- 空の訳文・途中で切れた訳文の検出。
- AbortSignal によるキャンセル。

`npm run test:browser`: 13 シナリオ。Chrome for Testing 156.0.8078.4、隔離した一時プロファイル、ローカル API を使用。

- 実際の設定画面から保存し、service worker / provider を経由して接続。
- 390px の設定画面で横スクロールがないこと。
- 全文翻訳後もリンク・コード・フォーム・表・リスト・クリック処理を維持。
- content script から設定メッセージや storage 経由で API キーを読めないこと。
- 訳文のみ / 原文＋訳文の切り替え。
- 動的に追加・変更された本文の翻訳。
- 選択翻訳のポップアップ表示と終了。
- 原文復帰後の内容・クリック処理。
- 401 エラーで停止し、再試行で復旧。生の API エラー本文は非表示。
- 中断後に遅れて届いた訳文が挿入されないこと。
- 明示したサイトの自動翻訳登録と再読み込み。
- 390px の操作パネルと機能設定ダイアログ。
- 保存済み API キーの削除。

さらに、主要 JavaScript の構文確認、配布 ZIP の内容確認、設定画面・操作パネルのスクリーンショットによる目視確認を実施。

## 成果物

- `test-results/browser-report.json`
- `test-results/settings-desktop.png`
- `test-results/settings-mobile.png`
- `test-results/panel.png`
- `test-results/translated-page.png`
- `dist/luma-translate-0.1.0.zip`

画面内の API URL / モデル / 訳文はローカルのテストデータを含みます。

## 未検証・制限

- 実際の DeepSeek API キーを使った疎通、課金、翻訳品質は未検証。
- 日常利用のブラウザプロファイルにはインストールしていない。
- Edge そのもの、Safari、Firefox、モバイルでの実行は未検証。
- ローカル API の権限は一時的なテスト用 manifest に付与。ブラウザ自身のアクセス許可ダイアログの手動操作はこのテストでは検証していない。
- 任意の Web サイトでの完全なレイアウト保持は保証しない。
- PDF / OCR / 字幕 / iframe / サイト側 Shadow DOM は初版対象外。
- 元の Immersive Translate 拡張機能の内部解析・機能網羅比較は行っていない。

詳細な動作範囲とインストール方法は README を参照。
