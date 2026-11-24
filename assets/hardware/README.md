# ArcSense hardware assets

Put real renders or CAD exports here. The site uses the first option it finds and
shows a labeled placeholder until then. Never put drawn or fake hardware here.

## Hero image (any option)

- `hero.webp`: a still render of the device on the back, or of the two pods and
  the flex strip. About 1600 × 2000 px (4:5), rendered on `#0E1518` or with a
  transparent background.
- Without it, the hero uses `frame_000.webp` from the sequence if there is one.

## Option A: 3D model (preferred)

Current `hub.glb` was exported from the Fusion design "ArcSense hub + pod" (boards are
placeholder blocks). `hub.glb.b64.txt` is a base64 copy used by the hosted page, which
can't serve .glb files; regenerate it with `base64 -i hub.glb -o hub.glb.b64.txt`.


- `hub.glb`: the hub assembly, closed, in millimetres, Y up.
- Separate meshes (or nodes), named exactly:
  `shell_top`, `board`, `battery`, `motor`, `base_patch`
- Optional `pod_upper` node: kept hidden in the exploded view.
- PBR materials (metalness/roughness). Textures 2048 px or smaller.
- No Draco or Meshopt compression (the hosted page cannot load the decoders).
  Aim for under 8 MB.
- Build it from your Fusion shells plus the manufacturer CAD for the
  XIAO ESP32-S3, BNO055 and DRV2605L boards. In Fusion: export as OBJ or FBX,
  then assign materials and export GLB from Blender.
- The page explodes the layers along Y: `shell_top` moves up most,
  `battery` stays put, `base_patch` moves down.

## Option B: image sequence

- `frame_000.webp` … `frame_149.webp` (150 frames, three-digit numbers).
- 1600 × 1100 px or larger (16:11), camera fixed, closed at frame 0 and fully
  exploded at frame 149.
- Background color exactly `#0E1518` (the stage color) so the edges vanish.
- Optional phone set: `mobile/frame_000.webp` … about 800 px wide.
- Optional `labels.json` with each layer's position at frame 149, as fractions
  of the frame width and height:

```json
{ "shell_top": [0.62, 0.18], "board": [0.64, 0.36], "battery": [0.63, 0.52],
  "motor": [0.6, 0.66], "base_patch": [0.65, 0.82] }
```

## Testing locally

Open the site through a local server (not by double-clicking the file), or the
asset check cannot see these files:

```bash
cd arcsense_site && python3 -m http.server 8000
```
