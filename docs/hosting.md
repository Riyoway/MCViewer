# Vercel Hobbyでの運用

2026-10-05に公式資料を確認。無料枠はチーム全体で共有されるため、他のプロジェクトの使用量も確認する。

| 項目 | Hobbyの制約 | このアプリの対応 |
| --- | --- | --- |
| Deployment Storage | 保持している出力の合計10GB。上限超過でデプロイが止まる | 約2.5GBの生成素材をR2に分離。Vercel出力の予算を100MiBに設定 |
| Fast Data Transfer | 月100GB | ワールド・アトラス・天候・ゲーム音は外部CDNから直接取得 |
| Fast Origin Transfer | 月10GB | 外部素材をVercelのRewriteやFunctionで中継しない |
| CDN Requests | 月100万回 | 周辺チャンクだけを取得し、バージョン付き素材を長期キャッシュ |
| デプロイ | 1日100件 | 素材の公開は素材を変更したときだけ。コード更新とは分離 |
| CLIのソースアップロード | Hobbyは100MB | 通常のリリースはGit連携。100MiBの出力予算は独自の予防策であり、この制限とは別 |
| 用途 | 個人・非商用 | 商用化する場合はプランの再検討が必要 |

参照: [Hobby](https://vercel.com/docs/plans/hobby)、[Limits](https://vercel.com/docs/limits)、[Deployment Storage](https://vercel.com/docs/deployment-storage)、[保持ルールの変更](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage)。上限は変更されるため、実際のUsage表示を優先する。

## 配信構成

VercelにはJavaScript・CSS・メニュー画像・フォント・ローカルワールド読み込み用データを配置する。`public/generated`はCloudflare R2 Standardなどの外部ストレージに一度公開する。14サンプルワールドはそのまま保持する。ユーザーが追加したワールドとResource Packは従来どおりブラウザのIndexedDBに保存され、サーバーへアップロードしない。

`npm run build:vercel`は公開CDNを確認してからビルドする。URL未設定、不正なURL、素材の不一致、CORS不足、ワールド開始地点の欠落で停止する。Vercel環境で通常の`npm run build`を使ってもURL未設定なら素材コピー前に停止する。出力に`generated/`が含まれる場合、または100MiBを超える場合にも失敗する。

ローカルの`npm run dev`と外部URLを設定しない`npm run build`は、従来どおり手元の素材を使う。`npm run hosting:report`で素材の容量・ファイル数・バージョンを確認できる。

## Minecraft専用の配信先

サイトとVercelプロジェクトは`mcviewer`、サイトのドメインは`mcviewer.riyo.me`。専用バケットは`minecraft-world-viewer-assets`、公開ドメインは`assets.mcviewer.riyo.me`。既存のPrivate-arcadeのバケット・素材・プロジェクト設定には変更を加えていない。GitHubリポジトリは引き続き`Riyoway/mcviewer`。

VercelのProductionとPreviewには、次の環境変数を設定する。

```text
VITE_ASSET_BASE_URL=https://assets.mcviewer.riyo.me/generated/50dcf0c41c4a33f4e6224e15cb8b3c96e01c0a44
```

このURLは現在の生成素材のcommitを指す。アプリだけの更新では同じURLを使い、生成素材を変更したときだけ新しいバージョンへ切り替える。バケットは分離しているが、R2の無料枠と課金はCloudflareアカウント全体で共有される。

2026-10-05にCDNを`assets.mcviewer.riyo.me`へ変更した。同じバケットの同じオブジェクトを配信するため、素材の複製・再アップロードは行わない。旧CDNの`assets.mineconsole.riyo.me`も、既に開かれたページからの取得を維持するため有効にしている。サイトのDNSはCloudflareでCNAME `mcviewer` → `cname.vercel-dns.com`（DNS only）。VercelでDNS構成の正常判定とプロジェクトの再開を確認済み。ProductionとPreviewの`VITE_ASSET_BASE_URL`も新CDNへ更新している。

新CDNでも全14サンプルの開始地点を含む33ファイルの一致・CORSと公開用ビルドを再検証した。実ブラウザで14サンプルの一覧とTU46の開始地点を確認し、新CDNへの162リクエストがエラーなく完了した。旧CDNへのリクエストはなかった。

### VercelのビルドがCloudflareの403で止まる場合

2026-10-05のVercelビルドでは、CloudflareのSecurity Eventsで`source: botFight`・`ruleId: bot_fight_mode`のチャレンジを確認した。Bot Fight Modeはホスト単位でSkipできないため、既存サイトの設定は維持し、専用R2バケットの開発用URLをビルド検証にだけ使用する。[Bot Fight Modeの制限](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/#rules)

ProductionとPreviewのビルド用環境変数は次の値。`VITE_`を付けず、ブラウザには渡さない。

```text
ASSET_CHECK_BASE_URL=https://pub-05a87b24ae2541febc212d4112922429.r2.dev/generated/50dcf0c41c4a33f4e6224e15cb8b3c96e01c0a44
```

検証はまず本番CDNへ接続し、HTTP 403かつ`cf-mitigated: challenge`の場合だけこのURLへ切り替える。R2開発用ホストと本番URLの素材パス・commit SHAが一致しない設定を拒否し、切り替え後も全14サンプルの開始地点を含む33ファイルのSHA-256・CORS・圧縮ヘッダーを検証する。通常の403、404、データの不一致はそのままビルドを停止する。素材を更新するときは両方の環境変数のSHAを揃える。

`r2.dev`には開発用のレート制限があり、本番の配信先には使わない。ブラウザは引き続き`assets.mcviewer.riyo.me`を参照する。検証URLにも同じ公開素材が見えるが、Private-arcadeのバケットやBot Fight Mode設定には変更を加えない。[R2公開バケット](https://developers.cloudflare.com/r2/buckets/public-buckets/)

2026-10-05に81,855ファイル・2,536,740,005バイトの初回公開を完了。全オブジェクトの件数・容量を照合し、全14サンプルの開始地点を含む33ファイルのSHA-256とCORSを検証した。専用の一時Workerで転送し、完了後にそのWorkerを削除している。実ブラウザではTU1・TU46・Halloween・Marioの各開始地点9チャンクを読み込み、通信エラーとJavaScriptエラーがないことを確認した。`npm test`と実CDNを参照する`npm run build:vercel`は成功し、出力は250ファイル・6.11 MiB。公開記録は[deployment/asset-release.json](../deployment/asset-release.json)に保存している。

素材公開・環境変数設定とProductionデプロイは別の作業。CDNの検証はローカルの公開用ビルドで行っている。Productionの結果はVercelのデプロイ状態と実サイトで確認する。

オブジェクトには1年間の`Cache-Control: public,max-age=31536000,immutable`を設定している。PNG・OGG・GZはCloudflareの既定のキャッシュ対象で、PNGの実配信でHITを確認した。JSONはブラウザでキャッシュされるが、Edgeでもキャッシュするには別途Cache Ruleが必要。現在は専用のCache Ruleを追加していない。[既定のキャッシュ動作](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)

## R2の初回準備

1. CloudflareアカウントでR2を有効にし、専用の**Standard**バケットを作る。生成素材専用にし、原本ZIPやユーザーのワールドを混ぜない。
2. バケットを公開用のカスタムドメインに接続する。`r2.dev`は開発向けでレート制限があるため、本番用には使わない。
3. 公開素材専用バケットに`deployment/r2-cors.json`のCORSルールを設定する。このファイルはAWS CLI形式なので、ダッシュボードに入力する場合は`CORSRules`の配列の中身を使う。GET/HEADだけを許可する。公開素材は認証なしで読み取れる必要がある。
4. Cloudflare Cache Rulesで`/generated/*`をキャッシュ対象にし、OriginのCache-Controlを尊重する。JSON・`.gz`も対象に含める。既定ではすべての拡張子がキャッシュされるわけではない。
5. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)をインストールする。対象バケットだけに権限を持つR2のS3 Access Keyを作り、`aws configure --profile minecraft-assets`に登録する。Regionは`auto`。秘密鍵をGitや`VITE_*`に入れない。
6. `.env.example`を`.env.local`へコピーし、`R2_ACCOUNT_ID`、`R2_BUCKET`、`R2_PUBLIC_URL`（例: `https://assets.example.com`）を設定する。`R2_PROFILE`はAWS CLIのプロファイル名、`ASSET_CHECK_ORIGIN`は公開アプリのOrigin。

公式: [公開バケット](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[CORS](https://developers.cloudflare.com/r2/buckets/cors/)、[AWS CLIとR2](https://developers.cloudflare.com/r2/examples/aws/aws-cli/)。

## 公開とVercelへの切り替え

```powershell
# 未コミットの生成素材がある場合は先にcommitする。
npm run assets:publish -- --dry-run
npm run assets:publish
```

スクリプトは`public/generated`を`generated/<素材のcommit SHA>/`に同期し、最後にManifestを公開する。既存のバージョンを削除しない。既にManifestが公開されていれば内容を検証し、一致する場合はアップロードを省略する。途中で失敗した場合は同じコマンドを再実行できる。8GiBを超える単一バージョンの公開は止めるが、これはR2全体の使用量を保証するチェックではない。

成功時に表示された`VITE_ASSET_BASE_URL=https://…/generated/<SHA>`をVercelのProductionとPreviewの環境変数に設定する。公開URLのCORSはPreviewでも必要なので、サンプル設定は公開素材に対して`*`を許可している。

```powershell
# 同じURLを.env.localにも設定してローカル確認
npm run assets:verify
npm run build:vercel
```

検証はManifest・アトラス・起動素材と全サンプルの開始地点のMesh/Voxelを実際に取得し、手元のSHA-256と比較する。全ファイルのHTTPチェックではないため、公開後はサンプル内の移動も確認する。事前の全ファイル同期が成功していることが前提。

圧縮済みのチャンク（`.gz`）に`Content-Encoding: gzip`を付けない。アプリ自身が解凍するため、HTTP側で解凍すると二重解凍になる。公開スクリプトはそのヘッダーを設定しない。

素材を変更しないコード更新ではCDNのURLを変えない。素材更新時だけ新しいバージョンを公開し、Vercel環境変数も変更する。公開済みのバージョン付きURLを上書きすると、長期キャッシュに異なる内容が混ざるため避ける。

## 既存の容量超過を解消する

小さい出力へ変更しても、既に保存されたVercelデプロイは消えない。容量超過で停止した場合は、素材の移行と保存容量の確認後に再開・再デプロイする必要がある。2026-10-05のドメイン変更時にはプロジェクトの再開を確認済み。

VercelでチームのUsage → Deployment Storage → Projectsを開き、どのプロジェクトが消費しているかを確認する。mcviewerの現行Productionを保持し、不要な旧デプロイだけを確認して削除する。削除するとそのURLとロールバック先が失われる。2026-09-16以降のHobbyは直近3件のProductionと直近3件の全デプロイ、現行Production、Aliasや有効なブランチなどを保護するため、保持日数を短くするだけでは全容量は空かない。他のプロジェクトを一括削除しない。

現行Vercel設定の保持日数は各状態1日。追加で短縮する必要はない。コードから旧デプロイを自動削除する処理は設けていない。

## R2の無料枠も監視する

R2 Standardの無料枠は月10GB-monthの保存・100万Class A操作・1000万Class B操作。インターネットへの転送は無料だが、保存や操作の超過は課金される。`r2.dev`や「無料だから無制限」を前提にしない。[R2料金](https://developers.cloudflare.com/r2/pricing/)

素材のバージョンを毎回複製するとR2でも容量が増える。素材が変わらない更新で再公開しないこと、古いバージョンの保持数と合計容量をUsageで確認すること。本番とロールバック用の2バージョンを目安とし、どちらも使用しなくなった古いバージョンを確認して削除する。ブラウザで開いたままの旧ページは旧URLを使うため、削除後に再読み込みが必要になる場合がある。
