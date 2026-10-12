# Rendering references

### Player and held items

The skin model follows [Mojang's humanoid geometry](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/models/entity/humanoid.custom.geo.json):
8×8×8 head, 8×12×4 torso, 4×12×4 limbs, shoulder and neck pivots,
0.5-pixel hat and 0.25-pixel clothing inflation. Modern 64×64 skins have
independent left limbs and clothing; legacy 64×32 skins mirror the right limbs.
Slim uses three-pixel arms and half-pixel lower shoulders. Skin import follows
[Minecraft's Classic/Slim PNG workflow](https://www.minecraft.net/en-us/article/what-is-minecraft-skin).
The model uses the [official player scale of 0.9375](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/entity/player.entity.json).
The viewer faces -Z, so skin-net side faces are mapped to that coordinate system.
Side and cap UVs join the front without reflection; source-only checks validate
the folded seams. 128×128 uses the same normalized skin net as 64×64. Imported
base areas are made opaque; clothing alpha is preserved, and legacy RGB skins
do not turn unused hat space into a solid cover. Geometry is rebuilt in place,
retaining the world player's groups and held-item attachment.

Home uses the official paper-doll defaults, starting rotation 30° and camera
tilt -10°, from the pinned [start screen](https://github.com/Mojang/bedrock-samples/blob/46ba6ea985fb5a92d79a9419198f10dda14c199d/resource_pack/ui/start_screen.json).

The walk cycle follows Java 1.12's `EntityLivingBase.travel` and `ModelBiped`:
each 20 Hz physics tick measures actual horizontal displacement, caps its
four-times-distance target at 1, eases the swing amount by 0.4, and accumulates
that eased amount as the phase. Rendering interpolates the previous/current
amount and phase, with a 0.6662 phase multiplier. Arms swing with amplitude 1;
legs use 1.4. Sprinting and creative flight share the cap, about 2.12 full cycles
per second. Vertical-only flight and blocked movement contribute no distance.
See [the native movement update](https://github.com/WangTingZheng/mcp940/blob/master/src/minecraft/net/minecraft/entity/EntityLivingBase.java),
[biped pose](https://github.com/WangTingZheng/mcp940/blob/master/src/minecraft/net/minecraft/client/model/ModelBiped.java)
and [render interpolation](https://github.com/WangTingZheng/mcp940/blob/master/src/minecraft/net/minecraft/client/renderer/entity/RenderLivingBase.java).

The same tick tracks head and body angles. Small stationary looks leave the
torso in place; movement turns it by 0.3 toward travel, with the native 95-degree
backward check, 75-degree head limit and extra 0.2 correction beyond 50 degrees.
Wrapped interpolation crosses ±180 degrees smoothly. The head is independent
of the torso's crouch and attack transforms and applies yaw before pitch,
so looking sideways and upward keeps the intended world direction. Idle arms
use the native 0.09/0.067 tick frequencies. The neck, torso and shoulders have
independent native pivots, with model X/Y rotations converted into the viewer's
right/up axes. Crouching lowers the neck and shoulders without sinking the feet;
the arm holding offset and attack arc follow the biped pose in the same axes.
The viewer keeps its Java-style pose;
this is not the complete modern Bedrock animation controller (equipment,
elytra, crawling and sprint-swimming states are not implemented).

First-person hand/items render in a separate scene after the world, using the
same projection and a cleared depth buffer. Liquids, clouds and precipitation
cannot blend over the item. Third-person held geometry is shared with the
first-person item and uses normal world depth testing. Item-specific third-person
resource-pack display transforms are not yet imported; blocks use the standard
75°/45° rotation and 0.375 scale.

### Gamma

In Legacy Console mode, Gamma is an integer from 0–100%, with a default of 50%. The console edition's settings path passes this value to the rendering library's output gamma while keeping Java-style lightmap brightness fixed at zero. See the [Console settings code](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/Common/Consoles_App.cpp) and [Console lightmap code](https://git.minecraftlegacy.com/MinecraftConsole/src/src/commit/b5111232aa13952f58ed1b3b3525ea825662b95c/Minecraft.Client/GameRenderer.cpp).

In the browser, the viewer references the Legacy4J curve corrected to match console analysis and uses `g = 0.5 + 1.5 × (setting / 100)` with `outputRGB = inputRGB^(1/g)`. Gamma values of 0% / 50% / 100% correspond to 0.5 / 1.25 / 2.0. The correction is applied to sRGB display values after the sky, fog, liquids, hand, HUD, and menus have been composited. Translucent surfaces and UI are not corrected separately before blending. Black and white remain fixed while midtones and shadows change. See the [curve correction based on console analysis](https://github.com/Wilyicaro/Legacy-Minecraft/commit/e434f3128e7f11c1e42ecee7492bcb786fbef4dc) and [Legacy4J screen correction](https://github.com/Wilyicaro/Legacy-Minecraft/blob/524efc8cef485025f98c065c35c81763b565c026/src/main/resources/assets/legacy/shaders/core/gamma.fsh).

Java mode uses the existing lightmap **Brightness** control instead. Settings are stored in the browser, and switching rendering modes does not apply both corrections at once. `/tests/gamma-check.html` on the development server checks WebGL colors, HTML HUD rendering, and translucent compositing. At 512×256, Java mode and 0/25/50/75/100% can be saved as `probe-java.png`, `probe-0.png`, and similar files, then compared against the reference curve using `npx tsx tests/gamma-readback.ts <output-path>`. No cross-device comparison of the rendering library has been performed.
