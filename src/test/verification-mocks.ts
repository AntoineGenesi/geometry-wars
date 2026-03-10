/**
 * Verification Mock Template
 *
 * vi.mock() calls MUST be in each test file (vitest hoists them).
 * This file provides the mock factory CONFIGS so you only write short declarations.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW TO USE — Copy this block into your test file:
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   import { vi } from 'vitest';
 *   import '../test/verification-env';  // DOM shims (side-effect import)
 *
 *   // --- Required mocks (copy these vi.mock calls into your test file) ---
 *   vi.mock('../audio/SoundEngine', () => ({
 *     getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
 *   }));
 *   vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
 *     EffectComposer: class { passes: any[]=[]; addPass(p:any){this.passes.push(p)} render(){} setSize(){} dispose(){} },
 *   }));
 *   vi.mock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: class {} }));
 *   vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({ UnrealBloomPass: class {} }));
 *   vi.mock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: class {} }));
 *   vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({ ShaderPass: class {} }));
 *   vi.mock('three/webgpu', () => ({ PostProcessing: class { render(){} } }));
 *   vi.mock('../rendering/GPUCapabilities', () => ({
 *     detectGPUCapabilities: vi.fn().mockResolvedValue({
 *       webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
 *       maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
 *       renderer: 'Mock', vendor: 'Mock', webgpuAdapter: '', tier: 'medium',
 *     }),
 *   }));
 *   vi.mock('../rendering/RendererFactory', () => ({
 *     createRenderer: vi.fn().mockResolvedValue({ renderer: {}, isWebGPU: false, backend: 'webgl2' }),
 *     resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
 *   }));
 *   vi.mock('three', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('three')>();
 *     return { ...actual, WebGLRenderer: class {
 *       domElement = { style:{}, width:800, height:600, addEventListener:()=>{}, removeEventListener:()=>{}, remove:()=>{}, getContext:()=>null, toDataURL:()=>'' };
 *       toneMapping = actual.NoToneMapping; toneMappingExposure = 1; shadowMap = { enabled: false };
 *       outputColorSpace = actual.SRGBColorSpace; info = { render: { calls:0, triangles:0 } };
 *       setSize(){} setPixelRatio(){} render(){} dispose(){} getPixelRatio(){return 1}
 *       getSize(t:any){return t?.set?.(800,600) ?? new actual.Vector2(800,600)}
 *     }};
 *   });
 *
 *   // --- Now import the harness ---
 *   import { RealGameTestHarness } from './RealGameTestHarness';
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THAT'S IT! You now have full access to the verification framework.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * See RealGameTestHarness.ts for the full API documentation.
 * See playground-verification.test.ts for a complete working example.
 */

// This file is documentation-only — it's a template, not executable.
// The vi.mock calls must be physically present in each test file.
export {};
