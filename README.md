# Minecraft Worlds

Three.js + TypeScript + Viteのワールド探索ビューア。Tutorial TU1 / TU3 / TU5 / TU7 / TU9 / TU12 / TU14 / TU19 / TU31 / TU46と、Super Mario / Festive / Halloween / Chinese Mythologyの実ワールドに直接入ります。

## 起動

Node.js 22.12以上。生成済みの素材・14マップと、再生成に必要なResource Pack・参照素材・元のワールドZIPをリポジトリに収録しています。

```sh
npm ci
npm run dev
```

マップ選択画面で読み込みが終わったら「プレイ」を押してください。素材やメッシュを変更したときは`npm run assets`で全マップを再生成します。未生成のマップだけ追加する場合は`npm run assets -- --append`を使えます。収録した元ZIPのMD5を配布定義と照合し、元ZIPがないときは従来のキャッシュ・ダウンロードを使用してリポジトリに保存します。全マップの再生成には数十分かかります。

```sh
npm test
npm run build
npm run preview
```

## 操作

| 操作 | キー |
| --- | --- |
| 移動・視線 | WASD・マウス |
| ジャンプ・水中で浮上 | Space |
| ダッシュ | Ctrl / Wを2回押して前進 |
| スニーク | Shift |
| 一人称 → 三人称背面 → 三人称正面 | F5 / V |
| 飛行の切り替え | Spaceを2回 |
| 飛行中の上昇・下降 | Space / Shift |
| ドアの開閉 | E / 右クリック |
| 腕を振る | 左クリック |
| メニュー | Esc |
| 座標・FPS | F3 |

20Hzの移動計算に描画時の補間を組み合わせています。ジャンプは0.42ブロック/ティック、重力0.08・減衰0.98で、約1.25ブロックの高さになります。地面の摩擦による加速・停止、空中の加速、ダッシュジャンプの前進力、氷・スライムの滑り、飛行の慣性と着地解除、水際での0.3の浮上力を使います。実地形の衝突箱、0.6段差移動、スニーク時の崖止め、三人称カメラの壁との衝突を扱います。未取得のチャンクには踏み込めません。

ドア操作と左クリックでは本家の6ティックの腕のスイングを使います。視点の揺れがオフでも操作時のスイングは有効です。Pointer Lockは対応ブラウザで生のマウス入力を使い、ロック直後・フォーカス復帰・画面をまたぐときの異常な移動量を除外します。

## 表示と設定

元のResource PackのピクセルをNearestで拡大し、縮小は切り替え可能なミップマップで描画します。アトラスの余白とUV微分で別のタイルが混ざることを防ぎます。アニメーションは実素材の`.mcmeta`に従います。素材側の範囲外フレームはMinecraftの読み込みに合わせて除外します。

テクスチャ番号は面内で補間せず、アトラスの行境界で隣の画像が混ざることを防ぎます。開発サーバーの`/tests/atlas-check.html`で、近距離・遠距離・アニメーションを含むGPUの描画検証を実行できます。

チェストの14×10pxなどの各面は整数倍で格納し、元のピクセル境界をそのまま描画します。Single／Double／Trapped／Enderと各Resource Packで共通です。

アニメーションの待ち時間は共通のティック間隔にまとめ、同じ画像を待ち時間分だけ複製しません。素材のみの修正は`npm run assets -- --materials`で再出力でき、既存チャンクのVoxelパレットが一致することを検証します。パレットが変わった場合は通常の全変換が必要です。

Minecraftの面ごとの明暗（上1、下0.5、東西0.6、南北0.8）と頂点AOを使用します。天空光・ブロック光はそれぞれ0〜15で、窓や洞窟の入口から1段階ずつ伝播します。葉や水による減衰も反映します。テクスチャ・Tint・光をMinecraftと同じ表示色の空間で乗算し、白っぽくなる色空間の混同を避けています。Gammaは明るさのカーブを変更し、夜の暗さや屋内の明るさを調整できます。昼夜サイクルは標準20分。時刻、停止・再開、1日の長さを変更できます。太陽・月・雲は提供されたDefault素材、音楽は各Packの実OGGです。

葉などの穴のある素材は背後の面を残し、木目などのモデル回転もUVに反映します。回転した面を結合しても、1ブロックごとのテクスチャ密度を維持します。

Legacy Console / Java表示、Gamma、視野角、描画距離、720p・480p・画面解像度、ミップマップ、感度、音楽、視点の揺れ、雲を設定できます。設定はブラウザに保存します。視点の揺れは初期状態でオフです。旧設定の揺れだけを引き継がず、Gammaや音量などは保持します。Legacy Console表示は色味、フォグ、低解像度表示を合わせたプリセットで、Console版のレンダラー自体のエミュレーションではありません。

「プレイ」または「設定」のクリックで音声を有効にします。BGMと効果音の音量は別々に調整できます。メニューを開いてもBGMは継続し、再生に失敗しても音量設定を勝手にゼロへ変更しません。足音・着地音は地面の素材に合わせ、ドア／トラップドアの開閉音と泳ぐ音もMinecraft公式の実OGGを使います。

## データと描画

各マップの中心864×864ブロック、Y=0〜319を変換します。Java変換後に付け加えられた外周の地形は対象外です。収録範囲の端はチャンクの読み込み境界で停止します。絵画は旧チャンクのEntitiesと新しいentitiesリージョンの両方から、位置・向き・サイズと各パックの画像を復元します。Mob、Nether、Endは読み込みません。

`scripts/pack.ts`が親モデル、Variant、Multipart、各部品の回転、衝突箱と実テクスチャを解決します。ドアは元モデルの寸法を保持し、閉じた状態と開いた状態を同じ衝突データで切り替えます。Chest・Bed・Sign・Skullには実Entityテクスチャを使った形状を補います。チェストは単体／ラージの左右を区別し、蓋の高さ14/16、留め金、上向きYのUVを元モデルに合わせています。レッドストーンは保存された信号強度に応じた赤色を使います。

Entityのテクスチャは面ごとの領域を切り出してからアトラスに入れ、ベッドの枕・布団・脚などの元ピクセルを保持します。ベッドの回転したマットレスにも描画と共通の衝突箱を使います。旧NBTのドアは下半分の向き・開閉状態と上半分の蝶番・動力状態を組み合わせて復元し、三人称でもプレイヤーの目と視線からドアを操作します。

`scripts/prepare.ts`がNBTの旧IDと新Paletteを読み、チャンクごとに隠れた面を削除してGreedy Meshingします。AOと光が異なる面は結合しません。描画用Geometryと衝突用Voxel・光を圧縮して出力します。手とドアも同じ周囲光・Gammaで描画します。ブラウザは選択中のワールドの周辺だけを取得し、遠ざかったGeometryとVoxelを解放します。

`src/core/Movement.ts`が移動、`Player.ts`が入力と視点、`src/world/Sky.ts`が昼夜、`src/minecraft/WorldLoader.ts`がチャンクの取得・解放・ドアを担当します。`?debug`を付けるとローカル確認用の`window.memorySpace`が使えます。

水・溶岩は保存された水位と隣接ブロックから角の高さを加重平均し、流れの勾配に沿ってFlowテクスチャを回転させます。湖にはStill、滝の側面にはFlowを使い、同じ液体の内部面は出力しません。Waterloggedにも対応し、泳ぎと水中表示は液面の高さを参照します。柵の接続状態を隣接ブロックから復元し、木製／ネザーレンガの区別、接続を受け付けないブロック、ゲートの向きを反映します。柵の衝突箱は本家の1.5ブロックの高さを使います。Mojang公式1.21.6のLiquidBlockRenderer、FlowingFluid、FenceBlock、FenceGateBlockと同梱のnative衝突データで確認しています。

これは探索ビューアです。ブロックの設置・破壊、インベントリ、回路、Mob、ダメージや天候は実装していません。液体の形状と流れる向きは元ワールドの状態から復元し、ワールドを変更する液体の広がりのシミュレーションは行いません。複数Biomeの色、Block Entityの模様やSignの文字など、Minecraft本体の全描画仕様との完全一致は対象外で、未対応モデルは生成Manifestの`unsupported`に記録します。

素材・URL・チェックサムは提供されたファイルを使用します。Default BGMはMinecraft公式1.13 Asset Indexの`music/game/calm1.ogg`。キーボード操作は[Minecraft公式の操作ガイド](https://www.minecraft.net/article/minecraft-controls)と[Educationのキー一覧](https://edusupport.minecraft.net/hc/en-us/articles/360047116832-Minecraft-keyboard-and-mouse-controls)に合わせています。

調査では、Mojangの[Minecraft描画解説（GDC 2026）](https://media.gdcvault.com/gdc2026/Slides/Fairfield_AJ_ModernizingTheRenderingOfMinecraft.pdf)、[公式プレイヤーモデル](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/models/entity/humanoid.custom.geo.json)、Mojang公式配布の1.21.6クライアントと公式Mappingsを確認しました。ChestModel、ItemInHandRenderer、RedStoneWireBlock、light.glsl、lightmap.fshの寸法・配置・計算を参照しています。

部分モデルは面がある位置の光を使い、頭上の不透明ブロックの内部を参照しません。頂点の光は1/4レベルまで保持します。空の太陽・月は加算描画を使い、黒い背景を重ねません。各パックの太陽・月・雲と`assets/legacy/biome_overrides.json`の色を使います。Halloweenの昼の空は`#3d2300`、霧は`#e4880b`です。

## Vercel

`Riyoway/mineconsole`の`main`はVercelの`mineconsole`プロジェクトに接続済みです。`vercel.json`でVite・`npm ci`・`npm run build`・`dist`を指定しています。検証後にmainへpushすると自動デプロイされ、公開先は https://mineconsole.vercel.app です。

生成済みの`public/generated/`をcommitするため、Vercel側で長時間のマップ変換は実行しません。ビルド時に素材を`dist/generated/<素材を変更したcommit>/`へ配置し、URLが同じ間は1年間ブラウザでキャッシュします。素材を更新するとURLが変わり、古いManifestと新しい地形が混ざることを防ぎます。旧バージョンのページで未取得の素材がなくなった場合は、再読み込みが必要です。CLIから全素材を直接アップロードする方法は[Vercelのアップロード容量・ファイル数制限](https://vercel.com/docs/limits)に当たるため、このプロジェクトはGit連携からデプロイします。

マップ選択中は開始地点の9列だけを取得し、プレイ中に設定した描画距離まで読み込みます。BGMは再生操作まで先読みしません。マップ変更時に不要になった地形の通信を中断し、読み込みエラー後は連続した再取得を止めます。

VercelのDeployment Storageは、保持しているデプロイのビルド出力・静的素材の保存容量です。Hobbyのチーム枠は10GBで、直近3件のProductionなどは自動削除の対象から外れます。素材を外部に分けると新しいデプロイは小さくなりますが、既存のデプロイの容量は残ります。ブラウザキャッシュや先読みの削減は通信量の対策であり、保存容量は減らしません。[Deployment Storage](https://vercel.com/docs/deployment-storage)・[Hobbyの保持ルール](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage)

ワールド素材をCloudflare R2などへ分ける場合は、通常ビルドで生成した`dist/generated/`の中身を公開ストレージへ配置し、CORSでアプリのOriginを許可します。Vercelの環境変数に`VITE_ASSET_BASE_URL=https://assets.example.com/generated/<バージョン>`を設定すると、素材をそのURLから直接読み込み、Vercelのビルド出力には含めません。この構成の出力は約523KBです。素材を更新して別バージョンをアップロードした際は、このURLも変更します。Vercel経由のProxyやRewriteは使用しません。ストレージ側にもバージョン付きURLの長期Cache-Controlを設定してください。R2はStandardの無料枠に10GBの保存容量・月1,000万回の読み込みが含まれ、インターネットへの転送は無料ですが、操作・保存容量の超過は別途課金されます。[R2料金](https://developers.cloudflare.com/r2/pricing/)
