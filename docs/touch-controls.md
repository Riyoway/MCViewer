# Touch controls

The viewer detects coarse touch devices automatically and does not require
Pointer Lock or fullscreen. Controls keep separate pointer captures for movement,
camera and action fingers. Orientation changes, pointer cancellation, menus,
backgrounding and focus loss release held inputs.
Trusted taps request fullscreen followed by a landscape orientation lock. Menu
requests run after the button action to preserve file-picker activation. Browsers
without these APIs, or that refuse the request, continue in their normal layout;
they cannot be forced into landscape by a website. A supported fullscreen exit
allows the next tap to request it again. See the [Screen Orientation API](https://www.w3.org/TR/screen-orientation/).
Short jump taps are buffered through the next physics tick so the 20 Hz movement
loop does not drop them. Beginning flight from the ground also applies ascent.

## Controls

The phone/tablet Home uses the classic Bedrock start-screen arrangement: title
above a central Play / Settings / Sample Worlds column, a rotating Steve preview
on the right, and language/help controls near the bottom. It uses the pinned
official `start_screen.json` layout and original light-button/title/glyph pixels
(see `public/menu/bedrock/SOURCE.md`). Sample Worlds occupies the store row;
Controls occupies the profile-button area. The viewer has no Marketplace or
account/skin editor. Desktop retains its Java-style Home.

The preview can be dragged horizontally to rotate; arrow keys also work when it
is focused. It renders with the existing WebGL context and restores its viewport
and scissor, without allocating another renderer. Portrait layouts fit before
the first fullscreen request. All Home labels and preview accessibility text
follow the five existing languages. Home touch buttons activate on release and
discard duplicate compatibility clicks after a drag.

Three Bedrock-style modes are available in Options → Controls → Touch:

- **Joystick & Tap to Interact**: analog movement on the left, swipe anywhere
  else to look, tap the block under your finger to use/place, hold to break.
- **D-Pad & Tap to Interact**: sliding directional pad with diagonal movement,
  double-tap forward to sprint, center to toggle sneaking, direct block targeting.
- **Joystick & Aim Crosshair**: swipe to look; Attack and Use act at the center
  crosshair. Disabling Show Action Buttons enables taps/holds at the crosshair.

Jump twice to begin creative flight. Hold Ascend/Descend to fly vertically;
double-tap Descend to stop flying. The same controls ascend/descend in water.
Sneaking toggles on the ground and keeps the existing edge protection.
Sprint can use a toggle button or the full joystick stroke (Sprint on Movement).
Fixed Joystick can be disabled to place it under the left thumb.

Hotbar slots select immediately. The `...` button opens the creative catalog,
where an item tap assigns the selected slot. Swipe the catalog or drag its
scrollbar to browse. Search appears only when explicitly tapped; opening the
inventory does not bring up the phone keyboard. The X closes inventory.

Buttons use original, pinned Mojang Bedrock texture pixels. All touch settings
are saved locally. Safe-area insets keep controls clear of notches/home bars;
menus scroll in short landscape windows. Desktop Pointer Lock, keyboard and
mouse input retain their existing controls.
Fresh touch devices start at a three-chunk render distance to reduce memory and
download load; existing saved video settings are preserved.

## Reference and implementation limits

Primary references:

- [Minecraft Controls](https://www.minecraft.net/en-us/article/minecraft-controls):
  swipe/look, movement, sprint, creative flight, sneaking, pause and inventory.
- [Bedrock 1.19.50 changelog](https://www.minecraft.net/de-de/article/1-19-50-update-available-bedrock):
  the three modes, delayed creative breaking, independent look/actions,
  double-tap Descend to cancel flight, and joystick behavior.
- [Mojang touch-control announcement](https://feedback.minecraft.net/hc/en-us/community/posts/4681918652045-Updated-Touch-Controls-Feedback-Bedrock-Beta):
  touch versus crosshair targeting, static joystick and sprint/action settings.
- [Official Mojang resource pack](https://github.com/Mojang/bedrock-samples/tree/46ba6ea985fb5a92d79a9419198f10dda14c199d/resource_pack/textures):
  exact button/joystick images; source notice is bundled in `public/menu/touch/`.

The interaction model follows these documented controls; this is not a complete
Bedrock engine or a pixel-identical copy of its inventory. The viewer keeps its
existing 20 Hz Java-style movement simulation and creative catalog. Touch
auto jump adds a collision/headroom check for one-block steps. Mobile look
sensitivity is normalized to the shorter viewport dimension. A 7 CSS-pixel drag
threshold and optional 250 ms creative hold delay distinguish taps from looking;
those tuning values are implementation choices, not measured Bedrock constants.

Source-only regression tests cover simultaneous inputs, gesture cancellation,
tap/hold/drag separation, crosshair actions, D-pad sprint and auto-jump obstacles.
Browser checks use Chrome mobile emulation in portrait and landscape and real
CDP touch events with multiple fingers. Physical iOS/Android hardware and its
latency have not been tested; device-specific Safari or Android rendering/input
differences may need follow-up tuning.

To repeat browser checks, run `npm run dev -- --port 5180 --strictPort` in one
terminal and `npm run test:touch-browser` in another. This test needs Chrome
installed and access to the published R2 sample assets. `TOUCH_TEST_URL` can
override the server URL (include `?debug`); `BROWSER_CHANNEL` can select an
installed Chromium channel. Screenshots are saved in ignored `test-results/touch/`.
`npm run test:player-browser` additionally checks trusted-tap fullscreen ordering,
transparent-liquid occlusion of the hand pass, and front/back player rendering.
Its fullscreen API is emulated; physical device rotation still needs device testing.
`npm run test:mobile-home-browser` covers the four Home viewport layouts, native
images, player rotation, returning from settings/help/language, sample selection
and the desktop layout. `HOME_TEST_URL` can point to a deployed URL with `?debug`.
