# リリースと署名

## アップデート署名キー

アップデート用の鍵は Tauri signer で生成します。

```sh
npx tauri signer generate -w ~/.tauri/pdfreader.key
```

生成時に表示される秘密鍵をリポジトリの Actions secret `TAURI_SIGNING_PRIVATE_KEY` に、設定したパスワードを `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に登録します。公開鍵はリポジトリ変数 `TAURI_UPDATER_PUBKEY` に登録します。秘密鍵はリポジトリへコミットしないでください。秘密鍵が未設定ならアップデート署名アーティファクトを作成せず、アプリも updater を有効にしません。

## コード署名 secrets

- Windows: `WINDOWS_CERTIFICATE`（PFX の Base64）、`WINDOWS_CERTIFICATE_PASSWORD`
- macOS: `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`

必要な署名情報がそろうと Release workflow が自動的に署名を有効にします。登録されていないプラットフォームのビルドは未署名のままです。OSS プロジェクト向けの無償申請先として SignPath Foundation、費用を抑えた選択肢として Azure Trusted Signing も検討できます。

## リリース手順

1. `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` のバージョンを同じ値に更新し、`Cargo.lock` にも反映して変更をマージします。workflow はタグから `v` を除いた値とこれらの3つのバージョンが一致しない場合、ビルド前に失敗します。
2. 変更点を注釈付きタグのメッセージに記載し、`v0.2.0` のような `v*` タグを作成して push します。

   ```sh
   git tag -a v0.2.0 -m "変更点…"
   git push origin v0.2.0
   ```

   必要なら Actions の Release workflow を手動実行し、`release_tag` にタグ名を指定できます。
3. workflow はタグメッセージをリリースノートとして使い、Windows x64 と macOS Universal をビルドして同じタグの draft release に成果物をアップロードします。アップデート署名キーが設定済みの場合は署名アーティファクトと `latest.json` も生成します。
4. 成果物と署名を確認してから draft release を公開します。利用者の更新確認は公開済みの GitHub Release を参照します。

アプリ内の更新ダイアログに表示されるリリースノートはビルド時にタグメッセージから生成されます。draft release の本文を後から編集しても、既に生成された `latest.json` のノートは変わりません。

## 未署名ビルドを開く

未署名の Windows インストーラーでは SmartScreen の警告が表示されることがあります。発行元を確認したうえで、必要なら「詳細情報」→「実行」を選びます。

macOS ではダウンロードしたアプリを右クリックして「開く」を選び、確認ダイアログでもう一度「開く」を選択します。隔離属性を解除する必要がある場合は、アプリの場所を確認したうえで次を実行できます。

```sh
xattr -d com.apple.quarantine /Applications/PDFReader.app
```
