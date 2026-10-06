# Minecraft World Viewer

A browser-based viewer for exploring saved Minecraft Java Edition worlds, built with Three.js, TypeScript, and Vite. It includes 14 sample worlds: Tutorial TU1 / TU3 / TU5 / TU7 / TU9 / TU12 / TU14 / TU19 / TU31 / TU46, plus Super Mario / Festive / Halloween / Chinese Mythology.

From the home screen, choose **Select World** → **Add World**, then select either a ZIP containing `level.dat` and `region/*.mca`, or a world folder. A Java-format Resource Pack ZIP can also be selected from the same screen. Imported files are stored in IndexedDB and are never uploaded to a server. Worlds remain available after reloading the page, and each world can have its resource pack changed or removed, be deleted, or have block edits reset. **Sample Worlds** are listed separately from user-added worlds.

The home panorama, logo, buttons, Unicode/ASCII fonts, click sound, and menu BGM are extracted from the EPK inside a user-supplied `Minecraft-1.12.2-js.html`. The original client JavaScript is neither executed nor redistributed. The UI uses the 1.12.2 GUI dimensions and integer scaling, dimmed dirt backgrounds, native-style sliders, and value-toggle option buttons. Esc and menu settings are connected to World Viewer actions. Sample chunks are not prefetched from the home screen.

Worlds are parsed in a Worker using NBT and region data, and only nearby chunks are meshed. The viewer supports pre-1.13 ID/Data values, 1.13+ palettes, negative heights from 1.18+, stored lighting, and biome data. Resource Packs support both old and new `block` / `blocks` texture naming, entity texture face regions, animation frame order and timing, standard block-model parents, variants, multipart models, per-part rotation, and sun, moon, and cloud textures. Removing a pack or switching worlds restores the original assets.

The supported scope is the Java Anvil Overworld. Bedrock `.mcworld` / LevelDB, external `.mcc` chunks, Zstd compression, per-Mob and Block Entity data, and OptiFine/shader-specific features are not supported. Painting entities in user-added worlds are currently unsupported. Blocks missing from the built-in palette are rendered as stone, while unsupported states fall back to the closest available state and are recorded under `unsupported` in the load result. High-resolution packs can be loaded, but their textures are downscaled into the existing 32px atlas. `.mcmeta` frame interpolation is not implemented. Existing sample-world reproductions, including paintings, are preserved.

The UI supports English by default, plus Japanese, Simplified Chinese, Traditional Chinese, and Korean. Languages can be changed from the globe icon on the home screen or from **Options → Language**. The selected language is stored in the browser, and switching languages does not reset the currently open world, settings, or user-defined names. Item names prefer official 1.13 translations, with newer IDs using 1.21.6 translations. UI and item-name dictionaries can be regenerated with `npm run ui-language`. The time buttons are viewer-specific shortcuts for Day (07:00 / 1000), Noon (12:00 / 6000), Night (19:00 / 13000), and Midnight (00:00 / 18000).

The home screen includes Minecraft copyright and unofficial-project notices. **Credits & Notices** on the home and pause menus lists rights holders, asset sources, community contributors, and library licenses. Public notices are stored in [public/menu/credits.html](public/menu/credits.html). Rights to all assets remain with their respective owners; copyright attribution does not grant redistribution permission. See the [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).

Re-extract menu assets with `npm run menu-assets -- <path-to-HTML>`. Regenerate the legacy ID/biome tables used for world loading and the source texture names used by the atlas with `npm run viewer-data`. Original block numbers and atlas pixels are not modified.

## Running

Requires Node.js 22.12 or newer. Generated assets, all 14 maps, the Resource Packs and reference materials required for regeneration, and the original world ZIP files are included in the repository.

```sh
npm ci
npm run dev
```

Selecting a world begins exploration immediately after loading. If the browser refuses mouse capture, the world is still displayed and controls can be activated by clicking the screen. Press Esc to pause. Interruptions caused by BGM switching are treated as normal behavior and do not display technical error banners. After changing assets or meshes, regenerate every map with `npm run assets`. To add only maps that have not yet been generated, use `npm run assets -- --append`. Included source ZIPs are checked against distribution definitions by MD5; if a source ZIP is missing, the previous cache/download path is used and the file is stored in the repository. Regenerating every map can take tens of minutes.

To regenerate only UI assets and rain-particle images, run `npm run ui-assets`. This uses real 1.13 GUI assets, item models, particle atlases, and the corresponding images from each Mash-up pack. Restart the Vite development server after adding new files. Japanese item names are verified against SHA-1 values from the official Asset Index.

```sh
npm test
npm run build
npm run preview
```

## Controls

| Action | Key |
| --- | --- |
| Move / look | WASD / mouse |
| Jump / rise in water | Space |
| Sprint | Ctrl / double-tap W while moving forward |
| Sneak | Shift |
| First person → third-person back → third-person front | F5 / V |
| Toggle flight | Double-tap Space |
| Ascend / descend while flying | Space / Shift |
| Open / close doors | Right click |
| Inventory | E (close with Esc) |
| Select item | Click an item to place it in the hotbar. Shift + click moves it to an empty slot. Hover and press 1–9 to assign directly |
| Break block (Creative) | Left click; hold for repeated breaking |
| Place block | Right click; use Shift + right click to place against a door |
| Pick targeted block | Middle click |
| Select hotbar slot | 1–9 / mouse wheel |
| Menu | Esc |
| Coordinates / FPS | F3 |

Movement is simulated at 20 Hz and interpolated during rendering. Jump velocity is 0.42 blocks/tick with gravity 0.08 and damping 0.98, producing a jump of roughly 1.25 blocks. Ground-friction acceleration and stopping, air acceleration, sprint-jump forward force, ice/slime sliding, flight inertia and landing cancellation, and 0.3 upward water-edge movement are implemented. Collision uses actual terrain collision boxes, supports 0.6-block step-up movement, sneaking edge protection, and third-person camera collision with walls. The player cannot enter chunks that have not been loaded.

Door interaction and left-click actions use the original-style six-tick arm swing. Action swings remain active even when view bobbing is disabled. Pointer Lock uses raw mouse input in supported browsers and filters abnormal deltas immediately after locking, restoring focus, or crossing displays.

Blocks are targeted using accurate shapes up to a distance of five blocks. Creative instant breaking, repeated breaking every five ticks, and repeated placement every four ticks are supported. The viewer updates slab merging, log axes, stair/door/bed orientation, two-block pairs, and fence/glass-pane/stair connections. It checks player overlap, supporting surfaces, map bounds, and unloaded chunks. First-person held items use each pack's actual models, item images, and display transforms. Breaking blocks emits texture fragments and native sound effects. In Creative mode, blocks are not broken while holding a sword.

Edits are stored per map in browser `localStorage` as differences from the original distributed data. They are reapplied when returning from another map, reloading the page, or reloading distant chunks. Modified sections and neighboring faces, AO, and lighting are rebuilt while saved paintings are preserved. Removing light sources such as torches clears stale light, and roof edits also update skylight and precipitation height. To add only material palette data, run `npm run building-assets`; held-item and GUI display data can be regenerated with `npm run ui-assets`. Original chunk block IDs and texture IDs are not changed.

## Rendering and Settings

Weather can be changed between Clear, Rain, Thunderstorm, and Snow (global). Rain and thunderstorms become snow according to the saved biome temperature and do not produce precipitation in dry biomes such as deserts. Rain particles stop at roofs, glass, and water surfaces, and rain audio is quieter indoors. Thunderstorms darken the sky, clouds, and sunlight and add lightning flashes and thunder. Precipitation intensity and the automatic weather-change interval are configurable and saved in the browser. Weather audio follows the sound-effect volume. To regenerate only weather assets and biome data, run `npm run weather-assets`; terrain meshes do not need to be rebuilt. See [Minecraft weather](https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/weather?view=minecraft-bedrock-stable).

Rain and snow rendering references Mojang's official 1.21.6 `WeatherEffectRenderer` and `LegacyRandomSource`. It uses a 21×21 precipitation area, a per-coordinate 48-bit random sequence, independent horizontal drift and fall speed for snow, a 3–4× rain speed coefficient, UV repetition every four blocks, distance-based transparency, and snow light-level adjustment. Random state is not recreated every frame, preventing the source texture's repeating pattern from lining up uniformly across the screen. Weather starts and stops with a five-second transition. Terrain is not altered by snowfall, freezing, or other weather effects.

Clouds expand each pack's source cloud image into 12×4×12-block cells and omit internal faces between adjacent cells. Rendering references Mojang's official 1.13 and 1.21.6 cloud implementations, including movement at 0.6 blocks per second, directional shading for top/bottom/east-west/north-south faces, 0.8 opacity, and day/night/rain/thunderstorm color changes. Legacy mode places clouds at the 1.13 height of 128.33, while Java mode places them at 192. A cloud-only depth pass runs before color rendering to prevent far back faces from stacking into unnaturally dark results. Clouds use their own distance fade so terrain fog does not abruptly cut off their edges.

Normal glass and glass panes discard transparent pixels and render the remaining pixels as opaque surfaces. Colored glass, water, and other translucent surfaces remain in the translucent pass. This prevents cloud rendering from erasing the visible glass pattern. Clouds render before translucent terrain while the camera is below them and after translucent terrain while the camera is above them. `/tests/cloud-check.html` on the development server performs GPU checks across five packs for glass views, positions above and below clouds, day/night lighting, roofs, and stained glass.

Source Resource Pack pixels are enlarged with nearest-neighbor filtering; downscaling uses optional mipmaps. Atlas padding and UV derivatives prevent neighboring tiles from bleeding into each other. Animations follow each asset's real `.mcmeta`. Out-of-range animation frames are removed to match Minecraft's loading behavior.

Texture indices are not interpolated within faces, preventing neighboring atlas rows from mixing. `/tests/atlas-check.html` on the development server performs GPU rendering checks at near and far distances, including animated textures.

Chest face regions such as 14×10px are stored at integer scale so original pixel boundaries are preserved. This applies consistently to Single, Double, Trapped, and Ender chests across Resource Packs.

Animation delays are normalized to a shared tick interval instead of duplicating the same image for every delay tick. Asset-only changes can be regenerated with `npm run assets -- --materials`, which verifies that existing chunk voxel palettes still match. If the palette changes, a normal full conversion is required.

Use `npm run fluid-assets` to regenerate only liquid assets. Still, Flow, and Overlay textures are reread from their source images, and the atlas is rebuilt while preserving texture IDs referenced by terrain. The full region for every animation is reserved before asynchronous image loading begins, preventing images and animations from overlapping. Playback speed and ping-pong frame order from each pack's `.mcmeta` are preserved. Every liquid frame in every pack is compared against its source image, and GPU tests verify frame timing. See the [official animated-block texture documentation](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable).

Minecraft-style directional shading is used for block faces (top 1.0, bottom 0.5, east/west 0.6, north/south 0.8) together with vertex AO. Skylight and block light each range from 0 to 15 and propagate one level at a time from windows and cave openings, including attenuation through leaves and water. Texture, tint, and light values are multiplied in the same display-color space used by Minecraft to avoid a washed-out result caused by color-space mixing. The default day/night cycle is 20 minutes. Time, pause/resume state, and day length can be changed. The sun, moon, and clouds use the supplied Default assets, and music uses each pack's actual OGG files.

### Gamma

In Legacy Console mode, Gamma is an integer from 0–100%, with a default of 50%. The console edition's settings path passes this value to the rendering library's output gamma while keeping Java-style lightmap brightness fixed at zero. See the [Console settings code](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/Common/Consoles_App.cpp) and [Console lightmap code](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/GameRenderer.cpp).

In the browser, the viewer references the Legacy4J curve corrected to match console analysis and uses `g = 0.5 + 1.5 × (setting / 100)` with `outputRGB = inputRGB^(1/g)`. Gamma values of 0% / 50% / 100% correspond to 0.5 / 1.25 / 2.0. The correction is applied to sRGB display values after the sky, fog, liquids, hand, HUD, and menus have been composited. Translucent surfaces and UI are not corrected separately before blending. Black and white remain fixed while midtones and shadows change. See the [curve correction based on console analysis](https://github.com/Wilyicaro/Legacy-Minecraft/commit/e434f3128e7f11c1e42ecee7492bcb786fbef4dc) and [Legacy4J screen correction](https://github.com/Wilyicaro/Legacy-Minecraft/blob/524efc8cef485025f98c065c35c81763b565c026/src/main/resources/assets/legacy/shaders/core/gamma.fsh).

Java mode uses the existing lightmap **Brightness** control instead. Settings are stored in the browser, and switching rendering modes does not apply both corrections at once. `/tests/gamma-check.html` on the development server checks WebGL colors, HTML HUD rendering, and translucent compositing. At 512×256, Java mode and 0/25/50/75/100% can be saved as `probe-java.png`, `probe-0.png`, and similar files, then compared against the reference curve using `npx tsx tests/gamma-readback.ts <output-path>`. No cross-device comparison of the rendering library has been performed.

Cutout materials such as leaves keep faces behind transparent regions, and model rotation such as log grain is reflected in UVs. Texture density remains one texture per block even when rotated faces are merged.

Settings include Legacy Console / Java rendering, Gamma, field of view, render distance, 720p / 480p / screen resolution, mipmaps, sensitivity, music, view bobbing, and clouds. Settings are saved in the browser. View bobbing is disabled by default. Only the old view-bobbing preference is intentionally not migrated; gamma, volume, and other settings are preserved. Legacy Console mode is a preset matching color, fog, and low-resolution presentation; it is not an emulation of the console edition renderer itself.

Audio is enabled after clicking **Play** or **Options**. BGM and sound-effect volume are controlled separately. BGM continues while menus are open, and playback failures do not silently force the volume setting to zero. Footstep and landing sounds match the ground material, while door/trapdoor sounds and swimming sounds use the actual official Minecraft OGG assets.

Rain audio references Mojang's official 1.13 `sounds.json` and 1.21.6 `WeatherEffectRenderer.tickRainParticles`. At 20 Hz it selects rain impact points within a 21×21-block area and layers short OGG clips. It does not loop a single sample, avoiding periodic gaps caused by sample fades. Outdoors, `rain1`–`rain8` play at volume 0.2 and pitch 1. Rain hitting a roof above the player uses `rain1`–`rain4` at volume 0.1 and pitch 0.5. Sounds use 16-block distance attenuation and stereo positioning. Existing sounds are allowed to decay naturally while moving between indoor and outdoor areas. No rain audio plays in snow, dry biomes, deep interiors where the sound cannot reach, menus, underwater, or while sound effects are muted. `/tests/rain-audio-check.html` renders the real OGG waveforms and verifies continuity and indoor/outdoor transitions.

## Data and Rendering

For each map, the central 864×864 blocks from Y=0–319 are converted. Outer terrain added after Java conversion is excluded. At the edge of the included area, movement stops at the chunk-loading boundary. Paintings are reconstructed from both legacy chunk Entities and newer entity-region files, including position, orientation, size, and per-pack images. Mobs, the Nether, and the End are not loaded.

`scripts/pack.ts` resolves parent models, variants, multipart models, per-part rotation, collision boxes, and actual textures. Doors preserve source-model dimensions and switch between open and closed states using the same collision data. Chest, Bed, Sign, and Skull shapes are supplemented with real entity textures. Chests distinguish single and left/right large variants, matching the source model's 14/16 lid height, latch, and upward-Y UV orientation. Redstone uses a red value based on its saved signal strength.

Entity textures are sliced into per-face regions before entering the atlas, preserving original pixels for details such as bed pillows, blankets, and legs. Rotated bed mattresses use the same collision geometry as rendering. Legacy-NBT doors reconstruct direction and open state from the lower half and hinge/powered state from the upper half. Door interaction in third person still uses the player's eye position and look direction.

`scripts/prepare.ts` reads both legacy NBT IDs and modern palettes, removes hidden faces per chunk, and applies greedy meshing. Faces with different AO or lighting are not merged. Render geometry plus collision voxels and light data are compressed for output. Hands and doors use the same ambient lighting and Gamma as the world. The browser fetches only data around the active world and releases distant geometry and voxels.

`src/core/Movement.ts` handles movement, `Player.ts` handles input and camera state, `src/world/Sky.ts` handles the day/night cycle, and `src/minecraft/WorldLoader.ts` handles chunk loading/unloading and doors. Add `?debug` to enable the local debugging object `window.memorySpace`.

Water and lava calculate corner heights using weighted averages from stored liquid levels and neighboring blocks, then rotate Flow textures along the local gradient. Lakes use Still textures, waterfall sides use Flow, and internal faces between the same liquid are omitted. Waterlogged blocks are supported, and swimming/underwater rendering uses the actual liquid surface height. Fence connection state is reconstructed from neighboring blocks, including wood/nether-brick distinctions, blocks that do not accept connections, and gate orientation. Fence collision uses Minecraft's 1.5-block height. Behavior is checked against Mojang's official 1.21.6 `LiquidBlockRenderer`, `FlowingFluid`, `FenceBlock`, and `FenceGateBlock`, together with the bundled native collision data.

The inventory supports a Creative material list and hotbar selection, and stores the selected contents and building edits per map in the browser. Crafting, redstone simulation, mobs, damage, falling-block physics such as sand, and liquid-spread simulation are not implemented. Liquid shape and flow direction are reconstructed from nearby saved state, while visible faces update around user-placed or removed obstacles. Unsupported models such as multi-biome color combinations, Block Entity patterns, and Sign text are recorded in the generated manifest under `unsupported`.

Assets, URLs, and checksums use the supplied source files. Default BGM is the official Minecraft 1.13 Asset Index file `music/game/calm1.ogg`. Keyboard controls follow the [official Minecraft controls guide](https://www.minecraft.net/article/minecraft-controls) and the [Minecraft Education keyboard/mouse control list](https://edusupport.minecraft.net/hc/en-us/articles/360047116832-Minecraft-keyboard-and-mouse-controls).

Research and implementation references include Mojang's [Minecraft rendering presentation (GDC 2026)](https://media.gdcvault.com/gdc2026/Slides/Fairfield_AJ_ModernizingTheRenderingOfMinecraft.pdf), the [official player model](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/models/entity/humanoid.custom.geo.json), Mojang's officially distributed 1.21.6 client, and official mappings. Dimensions, positioning, and calculations were checked against `ChestModel`, `ItemInHandRenderer`, `RedStoneWireBlock`, `light.glsl`, and `lightmap.fsh`.

Partial models use light from the location of the visible face instead of sampling inside an opaque block above it. Vertex lighting is preserved at quarter-level precision. The sun and moon use additive rendering and do not place a black background over the sky. Each pack's sun, moon, and cloud assets are used together with colors from `assets/legacy/biome_overrides.json`. Halloween's daytime sky is `#3d2300` and its fog is `#e4880b`.

Choosing **Reset Map** from the Esc game menu restores that map's block edits and door states after confirmation, then reloads from the original assets. Other maps, settings, and the hotbar are preserved.

Lighting and terrain calculations after block breaking/placement run in a Web Worker and replace only the modified 16³ section. Unedited terrain and paintings keep their generated render data, while input, collision, and particles continue updating during recalculation. If another edit occurs while a calculation is in progress, the stale result is discarded and recalculation starts from the latest state.

Block-break particles reference Mojang's official 1.21.6 `ParticleEngine.destroy`, `Particle`, and `TerrainParticle`. Each region of the block shape is subdivided into cells no larger than 1/4 block, with at least two subdivisions per axis, and particles use randomized initial velocity, upward acceleration, gravity, air drag, a 0.2-block collision box, and a finite lifetime. Physics runs at 20 Hz while rendering interpolates between frames. Particle textures come from the `particle` entry of each pack's model. `npm run particle-assets` can append only the required metadata and missing images to an existing atlas.

## Vercel

`Riyoway/mcviewer`'s `main` branch is connected to the Vercel `mcviewer` project. `vercel.json` configures Vite, `npm ci`, `npm run build:vercel`, and `dist`. The deployed site is [mcviewer.riyo.me](https://mcviewer.riyo.me/). The move to the new domain and project reactivation were confirmed on 2026-10-05.

Vercel hosts the application itself and the menu, while the roughly 2.5 GB `public/generated/` content is served directly from a Minecraft-specific R2 bucket through `assets.mcviewer.riyo.me`. Existing Private-arcade buckets, assets, and settings are not modified. `VITE_ASSET_BASE_URL` uses an immutable URL containing the asset commit SHA. Vercel builds verify CDN contents and CORS, and fail if the URL is unset, assets are missing or mismatched, or application output exceeds 100 MiB. Assets remain in the private repository and are not reconverted or copied by Vercel. Normal local builds can still bundle assets as before. See [the hosting destination](docs/hosting.md#minecraft専用の配信先) for the actual configuration values.

While a map is being selected, only the nine columns around the starting point are fetched; during play, loading expands to the configured render distance. BGM is not prefetched until playback is requested. Unneeded terrain requests are aborted when switching maps, and continuous retries stop after a loading failure.

Vercel Deployment Storage is the retained storage used by deployment build outputs and static assets. The Hobby team quota is 10 GB, and recent production deployments such as the latest three are excluded from automatic deletion. Moving assets outside Vercel reduces the size of new deployments but does not remove storage used by older retained deployments. Browser caching and reduced prefetching reduce transfer, not deployment storage. See [Deployment Storage](https://vercel.com/docs/deployment-storage) and [Hobby retention rules](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage).

See [docs/hosting.md](docs/hosting.md) for initial setup, deployment steps, and free-tier limits. Use `npm run hosting:report` to inspect storage, `npm run assets:publish -- --dry-run` to preview an upload plan, `npm run assets:publish` to publish to R2, and `npm run assets:verify` to verify the CDN. Code-only updates that do not change assets do not republish the CDN. R2 also has free allowances for storage and operations, but usage beyond them is billed, so check Usage regularly. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/).