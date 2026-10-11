# Touch controls

The viewer detects coarse touch devices automatically and does not require
Pointer Lock or fullscreen. Controls keep separate pointer captures for movement,
camera and action fingers. Orientation changes, pointer cancellation, menus,
backgrounding and focus loss release held inputs.
Short jump taps are buffered through the next physics tick so the 20 Hz movement
loop does not drop them. Beginning flight from the ground also applies ascent.

## Controls

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
