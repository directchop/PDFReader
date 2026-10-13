# PDFReader

Windows / macOS で動く、Rust + Tauri 2 ベースのローカル PDF リーダーです。Acrobat Reader の日常的な「読む・探す・印刷する」を置き換えることを目指しています。

**0.1.0 は閲覧・注釈機能を含むプレビュー版です。** OS との連携とファイル処理は Rust、画面は TypeScript、PDF の描画と全文検索は Mozilla PDF.js を使用します。Electron / Node.js ランタイムは同梱しません。

## 初版の機能

- 複数 PDF のタブ表示、タブごとのページ・倍率・回転・表示モードの保持
- 起動時に前回開いていたタブを復元（設定で無効化可能）。起動引数で開いた PDF は復元後にアクティブになります
- ネイティブのファイル選択、ドラッグ＆ドロップ、起動引数から開く
- サムネイル、埋め込み目次、ページ番号による移動
- テキスト選択、全文検索、日本語検索、検索結果のハイライト
- PDF のハイライト、テキスト注釈、手書き注釈と AcroForm の入力
- 注釈・フォームの変更は利用者が選んだ別ファイルに保存。元の PDF は上書きせず、変更を破棄する前に確認
- 検索語のあるページ・前後の文脈を表示する検索結果パネル
- PDF ごとのしおり（追加、名前変更、削除、ページ移動）
- 自動倍率、幅に合わせる、ページ全体、任意の倍率、90°回転
- 単ページ / 奇数・偶数ページ始まりの見開き、連続スクロール / 1 ページずつの切り替え
- Ctrl / ⌘ + ホイールやトラックパッドのピンチで、ポインター位置を基準に拡大・縮小
- 全画面表示（F11、macOS では Ctrl+⌘+F）
- F5 またはツールバーからプレゼンテーションモードへ切り替え
- パスワード付き PDF の閲覧（パスワードは保存しません）
- 印刷範囲を指定して OS の印刷画面を開く
- 最近使ったファイルを最大 12 件保存し、閲覧進捗の表示、個別削除、履歴消去が可能。見つからないファイルも履歴から確認・削除できます
- PDF ごとのページ・倍率・回転・見開き・スクロール方式を保存し、再度開いたときに閲覧位置を復元
- ウィンドウのサイズ・位置と、サイドバーの表示状態・ページ / 目次モードを保存
- デスクトップ版は、ディスク上で変更された PDF を安定確認後に自動で再読み込み（設定で無効化可能）
- 日本語 / English の UI（言語設定は自動 / 日本語 / English）
- ライト / ダーク / システムテーマと、PDF ページの色反転
- キーボードショートカット一覧
- PDF / フォント用 CMap / 標準フォント / WASM をすべてローカルで読み込み

### キーボードショートカット

Windows / Linux では `Ctrl`、macOS では `⌘` を使います（タブ切り替えは `Ctrl` キーです）。

| 操作 | キー |
| --- | --- |
| PDF を開く | Ctrl / ⌘ + O |
| 文書内を検索 | Ctrl / ⌘ + F |
| 印刷 | Ctrl / ⌘ + P |
| タブを閉じる | Ctrl / ⌘ + W |
| 現在のページにしおりを追加 / 削除 | Ctrl / ⌘ + D |
| 前 / 次のページ | ← / → |
| プレゼンテーション時の前 / 次のページ | ← / ↑ / PageUp / Backspace、→ / ↓ / Space / PageDown / Enter |
| 最初 / 最後のページ | Home / End |
| ページ番号を入力 | Ctrl / ⌘ + G |
| サイドバーを切り替え | Ctrl / ⌘ + B |
| ページを右に回転 | Ctrl / ⌘ + R |
| 次 / 前の検索結果 | F3 / Shift + F3 |
| 拡大 / 縮小 | Ctrl / ⌘ ++ / Ctrl / ⌘ +- |
| ページ全体に合わせる | Ctrl / ⌘ + 0 |
| タブを切り替え | Ctrl + Tab / Ctrl + Shift + Tab |
| 全画面表示を切り替え | F11（macOS: Ctrl + ⌘ + F） |
| プレゼンテーションモード | F5 |
| 注釈を別名で保存 | Ctrl / ⌘ + S |
| 注釈ツール: 選択 / ハイライト / テキスト / 手書き | V / H / T / I |
| ショートカット一覧を開く | ? / F1 |

日本語 / English の UI は設定から切り替えられ、テーマはライト / ダーク / システムから選べます。元の PDF への書き込み、アカウント登録、クラウド送信、テレメトリ、自動更新通信は実装していません。履歴・起動時のセッション・しおりはアプリのデータフォルダに別々に保存します。既定の PDF アプリの変更は OS の設定から利用者が行います。

## 開発環境

共通: Node.js 22.13 以降（CI は 24）、Rust **stable / 1.90 以降**。

Windows:

- Visual Studio Build Tools の「C++ によるデスクトップ開発」と Windows SDK
- Microsoft Edge WebView2 Runtime
- `rustup toolchain install stable-x86_64-pc-windows-msvc`

macOS:

- Xcode Command Line Tools (`xcode-select --install`)
- 開発対象は macOS 13.3 以降。実際の描画互換性は搭載 WebKit に依存します。

詳細は [Tauri の前提環境](https://v2.tauri.app/start/prerequisites/)を参照してください。

```sh
npm ci
npm run dev
```

Windows では npm スクリプトが MSVC ツールチェーンを選びます。マシン全体の Rust の既定設定は変更しません。

ブラウザだけで UI を確認する場合は `npm run web:dev` を実行してください。このプレビューのファイル読み込みはブラウザ API を使います。**Rust IPC・ネイティブ印刷・OS ファイル関連付けの検証にはデスクトップ版が必要です。**

## ビルド

```sh
# Windows: NSIS インストーラー / macOS: .app と .dmg
npm run desktop:build

# Mac の Intel / Apple Silicon 両対応
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:build -- --target universal-apple-darwin
```

出力先は `src-tauri/target/release/bundle/`。ターゲットを明示した場合は `src-tauri/target/<target>/release/bundle/` です。Windows の単体実行ファイルは `src-tauri/target/release/pdfreader.exe` です。

GitHub Actions では Windows x64 と macOS Universal のビルド設定を用意しています。インストーラーは Actions のアーティファクトに保存し、GitHub Release への公開は行いません。コード署名・Apple 公証は未設定です。WebView2 がない Windows への初回導入にはランタイムのインストールが必要です。

## テスト

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
```

Windows の既定 Rust が GNU の場合、直接実行する Cargo コマンドには `cargo +stable-x86_64-pc-windows-msvc ...` を使ってください。

- Rust: 読み取りトークンと範囲の検証、クローズ後の拒否、重複オープン、エラー後の継続、履歴の保存・消去・破損復帰
- UI: 実 PDF での日本語検索・目次・タブ・拡大回転、パスワード再試行・キャンセル、破損 PDF、印刷対象ページの生成、外部リクエストがないこと
- 印刷テストはブラウザで PDF 出力まで確認します。物理プリンターでの出力確認とは別です。
- Windows でビルド後に `npm run test:native` を実行すると、実際の Rust / WebView2 プロセスでファイル読み込み・日本語検索・不正トークンの拒否・印刷用 PDF 出力を確認します。テスト用プロセスだけにローカルのデバッグポートを設定します。物理プリンターには送信しません。

テスト用 PDF は本プロジェクトで作成した合成データです。再生成する場合のみ Python の `reportlab` / `pypdf` / `cryptography` を入れ、`python scripts/make-fixtures.py` を実行します。通常のビルド・テストには Python は不要です。

## 構成

| 場所 | 役割 |
| --- | --- |
| `src-tauri/src/documents.rs` | 読み取り専用ファイルハンドル、範囲読み取り、履歴管理 |
| `src-tauri/src/lib.rs` | Rust コマンド、ネイティブファイル選択、印刷、ドロップ・二重起動・Mac のファイルオープン |
| `src/transport.ts` | PDF.js から Rust への必要なバイト範囲の要求 |
| `src/main.ts` | タブ、PDF.js Viewer、検索、目次、印刷用ページ |
| `src/bridge.ts` | 型付き IPC とブラウザプレビュー用アダプター |
| `.github/workflows/ci.yml` | フロントエンドテストと Windows / Mac のビルド |

Rust は選択されたファイルをランダム ID で管理します。画面から任意のファイルパスを読み取るコマンドは公開せず、1 回の読み取りを 4 MiB 以下に制限します。PDF.js 側は必要な範囲を要求し、表示付近のページを描画します。ファイル全体を JSON の数値配列にして渡す処理はありません。

## プレビュー版の制限

- 最大 12 タブ、1 ファイル 1 GiB。ファイル形式や全文検索によっては全文の読み取り・相応のメモリが必要です。大容量文書の速度を保証するベンチマークはまだありません。
- 印刷は最大 150 dpi の画像を用紙に配置する方式です。1 回 100 ページ、合計 1.2 億ピクセルを上限とします。異なるページサイズの混在は、選択した先頭ページのサイズに合わせます。印刷画面で用紙・倍率・余白を確認してください。
- OS の印刷 API 呼び出し成功は、物理的な印刷完了を意味しません。
- スキャン画像の文字検索（OCR）、電子署名検証、XFA、ページ構成の変更・PDF 結合は未実装です。
- PDF 内の外部リンク、添付ファイルの実行、PDF JavaScript は有効化していません。
- macOS の実機描画、OS ファイル関連付け、物理プリンターとの互換性はリリース前の手動検証項目です。

## 次の段階

1. 実際の業務 PDF を用いた大容量・縦書き・埋め込みフォント・印刷の互換性確認
2. アクセシビリティの改善
3. 署名検証など Acrobat Reader との機能差の縮小
4. Windows コード署名、Apple 公証、更新配布の整備

## ライセンス

[Apache-2.0](LICENSE)。PDF.js は [Mozilla PDF.js](https://github.com/mozilla/pdf.js)、デスクトップ基盤は [Tauri](https://github.com/tauri-apps/tauri) を使用しています。PDF.js と同梱フォント・WASM のライセンスファイルはビルド時にアセットと一緒にコピーします。
