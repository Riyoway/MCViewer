# Minecraft World Viewer

Three.js + TypeScript + Viteで、Java版の保存済みワールドをブラウザで探索するビューア。Tutorial TU1 / TU3 / TU5 / TU7 / TU9 / TU12 / TU14 / TU19 / TU31 / TU46と、Super Mario / Festive / Halloween / Chinese Mythologyは14個のサンプルワールドとして収録しています。

ホームの「ワールドを選択」→「ワールドを追加」で、`level.dat`と`region/*.mca`を含むZIPまたはワールドのフォルダーを選びます。同じ画面でJava形式のResource Pack ZIPを指定できます。追加したファイルはIndexedDBへ保存し、サーバーには送信しません。再読み込み後にも一覧に残り、ワールドごとのパック変更・解除・削除と、ブロック編集のリセットが可能です。「サンプルワールド」は追加したワールドとは別の一覧です。

ホームのパノラマ、ロゴ、ボタン、Unicode/ASCIIフォント、クリック音、メニューBGMは、ユーザーが指定した`Minecraft-1.12.2-js.html`のEPKから抽出しています。元クライアントのJavaScriptは実行・配布しません。1.12.2のGUI寸法と整数倍率、土の背景の減光、ネイティブのスライダー・値を切り替える設定ボタンを使い、Escと設定はWorld Viewer用の操作につなげています。ホームではサンプルのチャンクを先読みしません。

ワールドはWorkerでNBT・リージョンを解析し、周囲のチャンクだけをメッシュ化します。1.12以前のID/Dataと、1.13以降のPalette、1.18以降の負の高さ、保存された光・バイオームに対応します。Resource Packは新旧のblock/blocksテクスチャ名、Entity画像の面領域、アニメーションのフレーム順と時間、標準ブロックモデルの親・Variant・Multipart・部品の回転、太陽・月・雲を反映します。パックの解除や別ワールドへの移動では元の素材を復元します。

対応範囲はJava AnvilのOverworldです。Bedrockの`.mcworld`/LevelDB、外部`.mcc`チャンク、Zstd圧縮、Mob・Block Entityの個別データ、OptiFine/シェーダー固有機能は対象外です。追加ワールドの絵画Entityは未対応です。用意されたパレットにないブロックは石、ない状態は最も近い状態で表示し、読み込み結果の`unsupported`に記録します。高解像度のパックも読み込みますが、テクスチャは既存の32pxアトラスへ縮小し、`.mcmeta`のフレーム間補間は行いません。サンプルワールドの絵画など、これまでの再現は保持します。

UIの表示言語は英語です。アイテム名の英語データは`npm run ui-language`で再生成します。

ホームにMinecraftの著作権と非公式表記を表示し、ホーム・ポーズメニューの「Credits & Notices」から権利者・素材の出典・コミュニティ貢献者・ライブラリのライセンスを確認できます。公開用の表記は[public/menu/credits.html](public/menu/credits.html)に収録しています。素材の権利はそれぞれの権利者に帰属し、著作権表記によって再配布の許諾が付与されるものではありません。[Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

メニュー素材の再抽出は`npm run menu-assets -- <HTMLのパス>`。ワールド読み込み用の旧ID・バイオーム表と、アトラスの元テクスチャ名は`npm run viewer-data`で再生成します。元のブロック番号・アトラスの画素は変えません。

## 起動

Node.js 22.12以上。生成済みの素材・14マップと、再生成に必要なResource Pack・参照素材・元のワールドZIPをリポジトリに収録しています。

```sh
npm ci
npm run dev
```

ワールドを選択して読み込みが終わったら「ワールドを開く」を押してください。素材やメッシュを変更したときは`npm run assets`で全マップを再生成します。未生成のマップだけ追加する場合は`npm run assets -- --append`を使えます。収録した元ZIPのMD5を配布定義と照合し、元ZIPがないときは従来のキャッシュ・ダウンロードを使用してリポジトリに保存します。全マップの再生成には数十分かかります。

UIと雨の粒子画像だけの再生成は`npm run ui-assets`で行えます。1.13の実GUI・アイテムモデル・粒子アトラスと、各Mash-upの対応画像を使用します。新規ファイルを追加した場合はViteの開発サーバーも再起動してください。日本語アイテム名は公式Asset IndexのSHA-1と照合します。

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
| ドアの開閉 | 右クリック |
| インベントリ | E（閉じる: Esc） |
| アイテム選択 | 一覧でクリックしてホットバーへ配置。Shift + クリックで空きスロットへ。ホバー中に1〜9で直接配置 |
| ブロック破壊（クリエイティブ） | 左クリック。長押しで連続破壊 |
| ブロック設置 | 右クリック。ドアに設置する場合はShift + 右クリック |
| 狙ったブロックを取得 | マウスの中央クリック |
| ホットバー選択 | 1〜9 / マウスホイール |
| メニュー | Esc |
| 座標・FPS | F3 |

20Hzの移動計算に描画時の補間を組み合わせています。ジャンプは0.42ブロック/ティック、重力0.08・減衰0.98で、約1.25ブロックの高さになります。地面の摩擦による加速・停止、空中の加速、ダッシュジャンプの前進力、氷・スライムの滑り、飛行の慣性と着地解除、水際での0.3の浮上力を使います。実地形の衝突箱、0.6段差移動、スニーク時の崖止め、三人称カメラの壁との衝突を扱います。未取得のチャンクには踏み込めません。

ドア操作と左クリックでは本家の6ティックの腕のスイングを使います。視点の揺れがオフでも操作時のスイングは有効です。Pointer Lockは対応ブラウザで生のマウス入力を使い、ロック直後・フォーカス復帰・画面をまたぐときの異常な移動量を除外します。

ブロックを5ブロックの距離まで正確な形状で選択し、クリエイティブの即時破壊・5ティックごとの連続破壊、4ティックごとの連続設置に対応します。スラブの合成、原木の軸、階段・ドア・ベッドの向き、2ブロックの対、柵・ガラス板・階段の接続を更新します。プレイヤーとの重なり、支持面、マップ境界・未取得チャンクを確認します。一人称の手持ちには各パックの実モデル・アイテム画像・表示変換を使い、破壊時には素材の破片とネイティブの効果音を出します。クリエイティブでは剣を持っている間はブロックを破壊しません。

変更は元の配布データに対する差分としてマップごとにブラウザのlocalStorageへ保存します。別のマップから戻る・ページを再読み込みする・遠くのチャンクを再取得する場合にも差分を適用します。変更したセクションと周辺の面・AO・光を再生成し、保存済みの絵画を保持します。松明などの光源を除去したときは古い光を消し、屋根の変更は日光と降水の高さにも反映します。素材パレットだけを追加するには`npm run building-assets`、手持ち・GUIの表示データは`npm run ui-assets`を実行します。元のチャンクのブロック番号・テクスチャ番号は変更しません。

## 表示と設定

天候は「晴れ・雨・雷雨・雪（全域）」から変更できます。雨と雷雨は保存されたバイオームの気温に従って雪に変わり、砂漠などでは降水を出しません。屋根・ガラス・水面で雨粒が止まり、屋内では雨音が小さくなります。雷雨には空・雲・日光の減光、落雷の閃光と雷鳴があります。降水量と自動変化の間隔も設定でき、選択はブラウザに保存されます。天候音は効果音の音量に従います。天候素材とバイオームだけ再生成する場合は`npm run weather-assets`を使います。地形のメッシュを作り直す必要はありません。[Minecraftの天候](https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/weather?view=minecraft-bedrock-stable)

雨・雪の描画はMojang公式1.21.6クライアントのWeatherEffectRendererとLegacyRandomSourceを参照しています。21×21の降水範囲、座標ごとの48bit乱数、雪の独立した横流れ・落下速度、雨の3〜4倍の速度係数、4ブロックごとのUV、距離による透明度、雪の光レベル補正を使います。乱数をフレームごとに作り直さず、元テクスチャの均等な模様が画面全体で揃うのを防ぎます。降水の開始・終了は5秒で移行します。天候による積雪・凍結などの地形の変更は行いません。

雲は各パックの元画像を12×4×12ブロックのセルに展開し、隣接セルの内部の面を省きます。Mojang公式1.13・1.21.6クライアントの雲描画を参照し、毎秒0.6ブロックの移動、上下・東西・南北の明暗、0.8の透明度、昼夜・雨・雷雨の色を反映します。Legacy表示では1.13の高さ128.33、Java表示では192に配置します。色の描画の前に雲だけの深度を描き、背面まで重ねて不自然に濃くなることを防ぎます。雲専用の距離フェードを使い、地形の霧で雲の端が突然切れないようにしています。

通常のガラスとガラス板は、透明部分を切り抜いて残りを不透明な面として描きます。色付きガラス・水などの半透明な面は別の描画に残します。これにより、ガラスの模様が雲によって消える問題を防ぎます。雲はその下にいるときは半透明地形より先、上にいるときは後に描きます。開発サーバーの`/tests/cloud-check.html`で、5種類のパックのガラス越し・雲の上下・昼夜・屋根・色付きガラスをGPUで検証できます。

元のResource PackのピクセルをNearestで拡大し、縮小は切り替え可能なミップマップで描画します。アトラスの余白とUV微分で別のタイルが混ざることを防ぎます。アニメーションは実素材の`.mcmeta`に従います。素材側の範囲外フレームはMinecraftの読み込みに合わせて除外します。

テクスチャ番号は面内で補間せず、アトラスの行境界で隣の画像が混ざることを防ぎます。開発サーバーの`/tests/atlas-check.html`で、近距離・遠距離・アニメーションを含むGPUの描画検証を実行できます。

チェストの14×10pxなどの各面は整数倍で格納し、元のピクセル境界をそのまま描画します。Single／Double／Trapped／Enderと各Resource Packで共通です。

アニメーションの待ち時間は共通のティック間隔にまとめ、同じ画像を待ち時間分だけ複製しません。素材のみの修正は`npm run assets -- --materials`で再出力でき、既存チャンクのVoxelパレットが一致することを検証します。パレットが変わった場合は通常の全変換が必要です。

液体素材だけの再生成には`npm run fluid-assets`を使います。Still・Flow・Overlayを元の画像から読み直し、地形内のテクスチャIDを保ってアトラスを配置し直します。画像を非同期に読み込む前に各アニメーションの領域全体を予約し、別の画像やアニメーションが重ならないようにしています。再生速度と往復するフレーム順は各パックの`.mcmeta`を維持します。全パックの全液体フレームを元画像と照合し、GPUでもフレームの表示時間を検証しています。[公式のアニメーション設定解説](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable)

Minecraftの面ごとの明暗（上1、下0.5、東西0.6、南北0.8）と頂点AOを使用します。天空光・ブロック光はそれぞれ0〜15で、窓や洞窟の入口から1段階ずつ伝播します。葉や水による減衰も反映します。テクスチャ・Tint・光をMinecraftと同じ表示色の空間で乗算し、白っぽくなる色空間の混同を避けています。昼夜サイクルは標準20分。時刻、停止・再開、1日の長さを変更できます。太陽・月・雲は提供されたDefault素材、音楽は各Packの実OGGです。

### Gamma

Legacy Console表示では、Gammaは整数の0〜100%、初期値50%です。Console版の設定処理はこの値を描画ライブラリの画面出力用Gammaへ渡し、ライトマップ内のJavaの明るさは0に固定します。[Console版の設定処理](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/Common/Consoles_App.cpp)、[Console版のライトマップ](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/GameRenderer.cpp)

ブラウザでは、Consoleの解析結果に合わせて修正されたLegacy4Jのカーブを参照し、`g = 0.5 + 1.5 × (設定値 / 100)`、`出力RGB = 入力RGB^(1/g)`を使います。0% / 50% / 100%のGammaは0.5 / 1.25 / 2.0です。sRGBの表示値で、空・霧・液体・手・HUD・メニューを合成した後に補正します。半透明の面やUIを先に個別補正してから混ぜることはありません。黒と白を保ち、中間色と暗部が変化します。[解析結果に合わせたカーブの修正](https://github.com/Wilyicaro/Legacy-Minecraft/commit/e434f3128e7f11c1e42ecee7492bcb786fbef4dc)、[Legacy4Jの画面補正](https://github.com/Wilyicaro/Legacy-Minecraft/blob/524efc8cef485025f98c065c35c81763b565c026/src/main/resources/assets/legacy/shaders/core/gamma.fsh)

Java表示では従来のライトマップの「明るさ」を使います。設定値はブラウザに保存し、表示方式の切り替え時に二重の補正をかけません。開発サーバーの`/tests/gamma-check.html`でWebGLの色、HTMLのHUD、半透明の合成を確認できます。512×256でJava表示と0/25/50/75/100%を`probe-java.png`、`probe-0.png`などとして保存し、`npx tsx tests/gamma-readback.ts <保存先>`で表示後の画素を参照カーブと照合できます。描画ライブラリを各実機で動かした比較は行っていません。

葉などの穴のある素材は背後の面を残し、木目などのモデル回転もUVに反映します。回転した面を結合しても、1ブロックごとのテクスチャ密度を維持します。

Legacy Console / Java表示、Gamma、視野角、描画距離、720p・480p・画面解像度、ミップマップ、感度、音楽、視点の揺れ、雲を設定できます。設定はブラウザに保存します。視点の揺れは初期状態でオフです。旧設定の揺れだけを引き継がず、Gammaや音量などは保持します。Legacy Console表示は色味、フォグ、低解像度表示を合わせたプリセットで、Console版のレンダラー自体のエミュレーションではありません。

「プレイ」または「設定」のクリックで音声を有効にします。BGMと効果音の音量は別々に調整できます。メニューを開いてもBGMは継続し、再生に失敗しても音量設定を勝手にゼロへ変更しません。足音・着地音は地面の素材に合わせ、ドア／トラップドアの開閉音と泳ぐ音もMinecraft公式の実OGGを使います。

雨音はMojang公式1.13の`sounds.json`と1.21.6の`WeatherEffectRenderer.tickRainParticles`を参照しています。20Hzで周囲21×21ブロックの雨の着地点を選び、短いOGGを重ねて鳴らします。単一の素材をループせず、素材の前後のフェードによる周期的な音切れを防ぎます。屋外はrain1〜8を音量0.2・音程1、頭上の屋根に当たる雨はrain1〜4を音量0.1・音程0.5で再生し、16ブロックの距離減衰と左右の位置を反映します。屋内外の移動では鳴っている音の余韻を残します。雪・乾燥バイオーム・音の届かない深い屋内では雨音を出さず、メニュー・水中・効果音のミュートにも対応します。開発サーバーの`/tests/rain-audio-check.html`で実OGGの波形をレンダリングし、音の連続性と屋内外の変化を検証できます。

## データと描画

各マップの中心864×864ブロック、Y=0〜319を変換します。Java変換後に付け加えられた外周の地形は対象外です。収録範囲の端はチャンクの読み込み境界で停止します。絵画は旧チャンクのEntitiesと新しいentitiesリージョンの両方から、位置・向き・サイズと各パックの画像を復元します。Mob、Nether、Endは読み込みません。

`scripts/pack.ts`が親モデル、Variant、Multipart、各部品の回転、衝突箱と実テクスチャを解決します。ドアは元モデルの寸法を保持し、閉じた状態と開いた状態を同じ衝突データで切り替えます。Chest・Bed・Sign・Skullには実Entityテクスチャを使った形状を補います。チェストは単体／ラージの左右を区別し、蓋の高さ14/16、留め金、上向きYのUVを元モデルに合わせています。レッドストーンは保存された信号強度に応じた赤色を使います。

Entityのテクスチャは面ごとの領域を切り出してからアトラスに入れ、ベッドの枕・布団・脚などの元ピクセルを保持します。ベッドの回転したマットレスにも描画と共通の衝突箱を使います。旧NBTのドアは下半分の向き・開閉状態と上半分の蝶番・動力状態を組み合わせて復元し、三人称でもプレイヤーの目と視線からドアを操作します。

`scripts/prepare.ts`がNBTの旧IDと新Paletteを読み、チャンクごとに隠れた面を削除してGreedy Meshingします。AOと光が異なる面は結合しません。描画用Geometryと衝突用Voxel・光を圧縮して出力します。手とドアも同じ周囲光・Gammaで描画します。ブラウザは選択中のワールドの周辺だけを取得し、遠ざかったGeometryとVoxelを解放します。

`src/core/Movement.ts`が移動、`Player.ts`が入力と視点、`src/world/Sky.ts`が昼夜、`src/minecraft/WorldLoader.ts`がチャンクの取得・解放・ドアを担当します。`?debug`を付けるとローカル確認用の`window.memorySpace`が使えます。

水・溶岩は保存された水位と隣接ブロックから角の高さを加重平均し、流れの勾配に沿ってFlowテクスチャを回転させます。湖にはStill、滝の側面にはFlowを使い、同じ液体の内部面は出力しません。Waterloggedにも対応し、泳ぎと水中表示は液面の高さを参照します。柵の接続状態を隣接ブロックから復元し、木製／ネザーレンガの区別、接続を受け付けないブロック、ゲートの向きを反映します。柵の衝突箱は本家の1.5ブロックの高さを使います。Mojang公式1.21.6のLiquidBlockRenderer、FlowingFluid、FenceBlock、FenceGateBlockと同梱のnative衝突データで確認しています。

インベントリはクリエイティブの素材一覧とホットバー選択に対応し、選んだ内容と建築の差分をマップごとにブラウザへ保存します。クラフト、回路、Mob、ダメージ、砂などの落下ブロックの物理、液体の広がりのシミュレーションは実装していません。液体の形状と流れる向きは周辺の保存状態から復元し、設置・破壊した障害物に合わせて面を更新します。複数Biomeの色、Block Entityの模様やSignの文字など、未対応モデルは生成Manifestの`unsupported`に記録します。

素材・URL・チェックサムは提供されたファイルを使用します。Default BGMはMinecraft公式1.13 Asset Indexの`music/game/calm1.ogg`。キーボード操作は[Minecraft公式の操作ガイド](https://www.minecraft.net/article/minecraft-controls)と[Educationのキー一覧](https://edusupport.minecraft.net/hc/en-us/articles/360047116832-Minecraft-keyboard-and-mouse-controls)に合わせています。

調査では、Mojangの[Minecraft描画解説（GDC 2026）](https://media.gdcvault.com/gdc2026/Slides/Fairfield_AJ_ModernizingTheRenderingOfMinecraft.pdf)、[公式プレイヤーモデル](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/models/entity/humanoid.custom.geo.json)、Mojang公式配布の1.21.6クライアントと公式Mappingsを確認しました。ChestModel、ItemInHandRenderer、RedStoneWireBlock、light.glsl、lightmap.fshの寸法・配置・計算を参照しています。

部分モデルは面がある位置の光を使い、頭上の不透明ブロックの内部を参照しません。頂点の光は1/4レベルまで保持します。空の太陽・月は加算描画を使い、黒い背景を重ねません。各パックの太陽・月・雲と`assets/legacy/biome_overrides.json`の色を使います。Halloweenの昼の空は`#3d2300`、霧は`#e4880b`です。

Escのゲームメニューから「マップをリセット」を選ぶと、確認後にそのマップのブロック編集とドアの状態を元に戻し、元の素材から読み直します。他のマップ、設定、ホットバーは保持します。

破壊・設置の光と地形の計算はWeb Workerで行い、変更した16³の区画だけを差し替えます。未編集の地形と絵画は生成済みの描画を保持し、計算中も入力・衝突・破片を更新します。計算途中に新しい編集があれば、古い結果を破棄して最新状態から計算します。

破壊の破片はMojang公式1.21.6クライアントのParticleEngine.destroy、Particle、TerrainParticleを参照しています。形状の各領域を最大1/4ブロック・各軸最低2分割で埋め、ランダムな初速と上向きの加速、重力、空気抵抗、.2ブロックの衝突箱、寿命を反映します。物理は20Hzで、描画はフレーム間を補間します。粒子用テクスチャは各パックのモデルの`particle`から取得します。`npm run particle-assets`で既存のAtlasに情報と不足する画像だけを追加できます。

## Vercel

`Riyoway/mcviewer`の`main`はVercelの`mcviewer`プロジェクトに接続済みです。`vercel.json`でVite・`npm ci`・`npm run build:vercel`・`dist`を指定しています。公開先は [mcviewer.riyo.me](https://mcviewer.riyo.me/) です。2026-10-05に新ドメインへの変更とプロジェクトの再開を確認しました。

Vercelにはアプリ本体とメニューを配置し、約2.5GBの`public/generated/`はMinecraft専用のR2バケットから`assets.mcviewer.riyo.me`経由で直接配信します。Private-arcadeの既存バケット・素材・設定には変更を加えません。`VITE_ASSET_BASE_URL`は素材のcommit SHAを含む固定URLにします。VercelビルドはCDNの内容とCORSを検証し、URL未設定・素材の欠落や不一致・100MiBを超えるアプリ出力を止めます。素材はprivate repoに保持し、Vercel側で再変換・コピーしません。ローカルの通常ビルドは従来どおり素材を同梱できます。実際の設定値は[配信先](docs/hosting.md#minecraft専用の配信先)を参照してください。

マップ選択中は開始地点の9列だけを取得し、プレイ中に設定した描画距離まで読み込みます。BGMは再生操作まで先読みしません。マップ変更時に不要になった地形の通信を中断し、読み込みエラー後は連続した再取得を止めます。

VercelのDeployment Storageは、保持しているデプロイのビルド出力・静的素材の保存容量です。Hobbyのチーム枠は10GBで、直近3件のProductionなどは自動削除の対象から外れます。素材を外部に分けると新しいデプロイは小さくなりますが、既存のデプロイの容量は残ります。ブラウザキャッシュや先読みの削減は通信量の対策であり、保存容量は減らしません。[Deployment Storage](https://vercel.com/docs/deployment-storage)・[Hobbyの保持ルール](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage)

初回設定・公開手順・無料枠の一覧は[docs/hosting.md](docs/hosting.md)を参照してください。`npm run hosting:report`で容量確認、`npm run assets:publish -- --dry-run`で公開計画の確認、`npm run assets:publish`でR2へ公開、`npm run assets:verify`でCDNの検証ができます。素材が変わらないコード更新ではCDNを再公開しません。R2にも保存・操作の無料枠があり、超過は課金されるためUsageを確認してください。[R2料金](https://developers.cloudflare.com/r2/pricing/)
