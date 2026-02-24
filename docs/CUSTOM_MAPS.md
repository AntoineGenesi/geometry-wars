# Custom Map Loading Guide

> **New feature!** Load your own 3D models as playable surfaces in Geometry Wars 3D. Create epic battles on custom meshes, or download ready-made maps from the community.

## What are Custom Maps?

Custom maps let you play Geometry Wars on any 3D model you can create or download. Instead of the 12 built-in surfaces (sphere, cube, torus, etc.), you can load:

- **Your own creations** — design in Blender or MagicaVoxel
- **Downloaded models** — from Sketchfab, TurboSquid, or other sites
- **Animated meshes** — watch the battlefield transform while you fight

The game automatically:
- Normalizes the mesh to fit the gameplay area
- Generates collision detection (BVH acceleration structure)
- Projects UV coordinates for enemy movement
- Handles multi-mesh models (merges them into one)

## Supported Formats

| Format | Extension | Best For | Pros | Cons |
|--------|-----------|----------|------|------|
| **OBJ** | `.obj` | Simple static meshes | Widely supported, human-readable | Large file size, no animations |
| **GLB** | `.glb` | Complex models + animations | Compact binary, supports animations | Requires modern tools to create |
| **GLTF** | `.gltf` | Detailed models (JSON + textures) | Flexible, comprehensive | Larger than GLB, harder to bundle |

**Recommendation:** Use **GLB** for high-quality models, **OBJ** for simple shapes.

## How to Load a Custom Map

### Option 1: Via File Picker (Recommended)

1. Click **START GAME** on the main menu
2. Select **Mode** (Waves, King, etc.)
3. Click **LOAD CUSTOM MAP**
4. Choose your .obj, .glb, or .gltf file from your computer
5. Game loads → start playing!

### Option 2: Via URL

If you're hosting a model online:

```
http://localhost:3000?map=https://example.com/models/bunny.glb
```

The game will download and load the model automatically.

### Option 3: Drag-and-Drop (if enabled)

Some versions support dragging a file onto the game window. Check the **Settings** menu to enable this.

## Creating Your Own Maps

### Requirements

For the best results, your mesh should be:

- **Watertight** — no holes or gaps (enemies move on the surface)
- **Manifold** — all faces are solid, no internal geometry
- **Reasonable polygon count** — 100,000 triangles max (game will warn if exceeded)
- **Convex-ish** — highly concave meshes work but look weird with player camera angles

### Polygon Count Guidelines

| Count | Performance | Recommendation |
|-------|-------------|-----------------|
| < 10,000 | Excellent (60 FPS stable) | Beginner-friendly, fast load |
| 10,000–50,000 | Good (60 FPS, slight variance) | Sweet spot for most maps |
| 50,000–100,000 | Fair (30–60 FPS variance) | Advanced, higher-end machines |
| > 100,000 | Poor (rejected by game) | Decimate first (see below) |

### Creating in Blender

1. **Create or import your model**
   ```
   File → Open (to import existing model)
   or
   Shift+A → Mesh → [choose primitive]
   ```

2. **Ensure it's watertight and manifold**
   ```
   Edit Mode → Select All (A) → Mesh → Normals → Recalculate Outside
   Alt+F → Face Orientation (shows red = inside-facing, should be none)
   ```

3. **Reduce polygon count if needed** (target: 50k triangles)
   ```
   Modifier → Add Modifier → Decimate
   Set "Ratio" to 0.5 (reduces to 50%)
   Apply
   (Repeat if needed)
   ```

4. **Export as GLB**
   ```
   File → Export → glTF 2.0 (.glb/.gltf)
   Format: glTF Binary (.glb)
   Click "Export glTF 2.0"
   ```

5. **Test in game** — load the file and make sure it works!

### Adding Animations (GLB only)

1. **Create a simple animation in Blender**
   - Timeline → Keyframe at frame 0
   - Move/rotate object
   - Keyframe at frame 48 (2 seconds at 24fps)

2. **Export with animation**
   ```
   File → Export → glTF 2.0
   Check "Animation" checkbox
   Export
   ```

3. **Load in game** — animation plays automatically at game speed

### Creating in MagicaVoxel

1. Create your voxel model normally
2. Export as `.obj`
3. Load in Geometry Wars — built-in polygon reduction handles optimization

## Sample Maps Included

The game comes with sample maps you can use as reference or starting points:

| Map | Size | Best For | Features |
|-----|------|----------|----------|
| **cup.obj** | 2k triangles | Learning, simple gameplay | Smooth convex shape, fast load |
| **torus.obj** | 5k triangles | Donut-shaped arena | Interesting topology, wrap-around feel |
| **knot.obj** | 10k triangles | Advanced players | Complex surface, challenging movement |
| **sphere-simple.obj** | 15k triangles | Reference | Similar to built-in sphere, compare gameplay |
| **bunny.obj** | 25k triangles | Iconic shape | Stanford Bunny, beloved by programmers |
| **dragon.obj** | 50k triangles | Big ambitious map | Large, intricate geometry |

All are free to use and share!

## Troubleshooting

### "Unsupported file type"
**Cause:** File extension is not .obj, .glb, or .gltf

**Solution:**
- Rename or re-export as one of the supported formats
- Check your file name for typos (case-sensitive on some systems)

### "Failed to load mesh — network error"
**Cause:** URL is unreachable or broken

**Solution:**
- Check the URL — is it correct?
- Is the file being served with CORS headers? (required for web)
- Try downloading the file locally and using the file picker instead

### "No mesh geometry found"
**Cause:** File is empty or corrupted

**Solution:**
- Re-export from your 3D tool
- Try opening the file in Blender to verify it's valid
- Check file size — should be > 1 KB

### "Mesh too large: 250,000 triangles (max: 100,000)"
**Cause:** Model has too many polygons

**Solution:**
1. Open in Blender
2. Add Decimate modifier, set ratio to 0.5
3. Check new triangle count: `Object Data → Geometry → Faces`
4. If still too large, decimate again to 0.25
5. Re-export and try again

### "Enemies floating off surface"
**Cause:** Mesh is not watertight (has holes, inside-facing faces, or is non-manifold)

**Solution:**
1. Open in Blender, Edit Mode
2. Select All (A), then:
   - **Remove doubles:** Mesh → Merge → By Distance
   - **Fix normals:** Mesh → Normals → Recalculate Outside
   - **Check manifold:** Alt+F → Face Orientation (should show NO red)
3. If still broken, consider re-creating the mesh

### "Game lags with custom map"
**Cause:** Polygon count is too high, or BVH structure is rebuilding

**Solution:**
- **Reduce triangles:** Decimate in Blender (target 20k–50k)
- **Disable animations:** Animated meshes rebuild BVH each frame (performance cost)
- **Close other browser tabs:** Free up GPU/CPU
- **Use a smaller file:** Try the sample cup.obj to confirm performance is acceptable

## Where to Find Maps

### Free Model Sites (CC0 License)

- **Sketchfab** — https://sketchfab.com (filter by "CC0")
- **Thingiverse** — https://www.thingiverse.com (3D-printable models)
- **Poly Haven** — https://polyhaven.com/models (high-quality free models)
- **Stanford 3D Repository** — https://graphics.stanford.edu/data/3Dscanrep/ (iconic models like bunny, dragon)
- **CGTrader Free** — https://www.cgtrader.com/free-3d-models (mix of free + paid)

### Tips for Finding Good Maps

1. **Check the license** — must be CC0, CC BY, or public domain
2. **Download GLB or OBJ** — these are most compatible
3. **Check poly count** — hover over the download to see file size (smaller = lower poly)
4. **Read the description** — check if it's optimized or if you need to decimate
5. **Download a few** — build a library of maps you like

## Advanced: Mesh Requirements & Constraints

### Why Watertight Matters

The game uses ray-casting and BVH queries to determine where the player and enemies can move. Non-manifold or non-watertight meshes cause:
- Enemies clipping through surfaces
- Player getting stuck
- Unpredictable movement behavior

Check manifoldness:
```
Blender → Edit Mode → Select All (A) → Mesh → Analyze → Mesh Analysis
If "Non-manifold edges" > 0, your mesh has problems
```

### UV Mapping

The game doesn't use pre-baked UV coordinates. Instead, it:
1. Computes a spherical projection around your mesh
2. For each (u, v) coordinate, ray-casts toward the mesh
3. Falls back to closest-point-on-surface if the ray misses

This works for **any** mesh shape, but performance depends on the mesh's concavity (very concave meshes may have many ray misses).

### Animation Performance

- Animated meshes rebuild the BVH tree **every frame** (animation plays, geometry changes → BVH invalidates)
- Each BVH rebuild: ~5ms per 50k triangles
- Recommendation: Keep animated maps **< 30k triangles** for smooth 60 FPS

## FAQ

**Q: Can I use maps with multiple meshes or skeletons?**
A: Yes! The loader automatically merges all meshes into one. However, skeletons/rigging are stripped — only the geometry is used.

**Q: Can I use models with textures?**
A: Textures are ignored (the map is rendered with a solid semi-transparent color). The game focuses on geometry.

**Q: How big can the map file be?**
A: GLB files compress well. Typical limits:
- OBJ: 50 MB (loading may be slow)
- GLB: 10 MB (recommended max, fast download)
- GLTF (with separate textures): 20 MB (more complex)

**Q: Can I share my custom map online?**
A: Yes! Export as GLB, upload to a hosting service (e.g., GitHub, itch.io asset pack), and share the URL. Friends can load it directly:
```
http://localhost:3000?map=https://your-host.com/my-map.glb
```

**Q: Will my map work in multiplayer?**
A: Yes! Custom maps work in all modes:
- Single-player ✓
- Local co-op (2 players, same screen) ✓
- LAN multiplayer (up to 4 players, same WiFi) ✓

**Q: What's the difference between OBJ and GLB?**

| Aspect | OBJ | GLB |
|--------|-----|-----|
| File size | Large (text-based) | Small (binary) |
| Load time | Slower | Faster |
| Animations | ✗ Not supported | ✓ Supported |
| Multi-mesh | ✗ Single mesh only | ✓ Supported |
| Compatibility | Widest support | Modern tools only |

**Q: My map loads but looks stretched/squashed. How do I fix it?**
A: The game auto-scales your mesh to fit a radius of 16 units. If your model has very different proportions:
1. Scale uniformly in Blender before export
2. Check the on-screen coordinates after loading (debug overlay, F4)
3. Try a different mesh if proportions are inherently extreme

---

**Have questions?** Check the [Developer Guide](DEV_CUSTOM_MESHES.md) for technical details, or file an issue on GitHub.
