## 2026-02-10 - WebGPU Renderer Implementation

**Context:** The RendererFactory always returned WebGL2 with a comment "Future: when Three.js WebGPURenderer is stable." Investigation found that Three.js 0.170 fully supports WebGPU via `three/webgpu` module, but the post-processing pipeline (EffectComposer + UnrealBloomPass) is WebGL-specific.

**Options Considered:**
1. Replace WebGLRenderer with WebGPURenderer entirely, rewrite all post-processing
   - Pros: Single code path, full WebGPU benefits
   - Cons: Massive scope, risk of breaking visuals, EffectComposer used throughout
2. Add WebGPU as opt-in via URL param, dual code paths
   - Pros: Safe, backwards compatible, incremental adoption
   - Cons: Two code paths to maintain
3. Keep WebGL2 only, document why
   - Pros: No risk
   - Cons: User explicitly asked for WebGPU support

**Decision:** Option 2 -- WebGPU is opt-in via `?renderer=webgpu` URL parameter.

**Reasoning:**
- WebGPURenderer extends `Renderer` (common base), not `WebGLRenderer` -- they are incompatible types
- `EffectComposer` internally uses `WebGLRenderTarget` and GLSL shaders -- cannot work with WebGPU backend
- WebGPU post-processing uses completely different `PostProcessing` class with TSL node graphs
- Three.js 0.170 does NOT have a built-in `bloom()` TSL function (added in later versions)
- Custom TSL bloom approximation built using `pass()` -> threshold -> mip blur -> composite
- WebGL2 remains default and battle-tested; WebGPU is experimental opt-in

**Key Technical Details:**
- `WebGPURenderer` is cast to `WebGLRenderer` for type compatibility (API surface is identical for the methods we use: setSize, setPixelRatio, render, domElement, dispose)
- WebGPU path uses `renderer.init()` which is async (adapter initialization)
- TSL bloom uses mip-level blur which is an approximation, not identical to UnrealBloomPass
- WebGPURenderer has built-in WebGL2 fallback if the browser doesn't support WebGPU

**Reversibility:** Easy -- remove the WebGPU code path in RendererFactory; the default WebGL2 path is unchanged.
