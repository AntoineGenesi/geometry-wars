/**
 * GPU Benchmark - measures max sustainable entity counts at various FPS targets.
 *
 * Spawns increasing numbers of animated meshes on a Three.js scene,
 * measures sustained FPS at each tier, and reports results.
 *
 * Designed to run independently of the main game loop.
 */

export interface BenchmarkScore {
  entityCount: number;
  avgFps: number;
  minFps: number;
}

export interface BenchmarkResult {
  /** Max entities that sustained >= 60fps */
  maxAt60fps: number;
  /** Max entities that sustained >= 30fps */
  maxAt30fps: number;
  /** Derived GPU tier from benchmark results */
  gpuTier: 'high' | 'medium' | 'low' | 'minimal';
  /** Per-tier scores */
  scores: BenchmarkScore[];
}

export type BenchmarkProgressCallback = (
  current: number,
  total: number,
  entityCount: number,
  fps: number
) => void;

/** Entity count tiers to test */
const BENCHMARK_TIERS = [100, 250, 500, 1000, 2000, 5000];

/** Frames to measure at each tier after warmup */
const MEASURE_FRAMES = 60;
/** Warmup frames to skip at each tier */
const WARMUP_FRAMES = 15;

/**
 * Run a GPU benchmark by rendering animated entities and measuring FPS.
 *
 * This creates a temporary canvas + Three.js renderer, runs through
 * increasing entity counts, and measures sustained FPS at each level.
 *
 * @param onProgress Optional callback for progress updates.
 * @returns BenchmarkResult with max sustainable counts and per-tier scores.
 */
export async function runGPUBenchmark(
  onProgress?: BenchmarkProgressCallback
): Promise<BenchmarkResult> {
  // Dynamic import to avoid pulling Three.js into test bundles
  const THREE = await import('three');

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.position = 'fixed';
  canvas.style.top = '-9999px';
  canvas.style.left = '-9999px';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(640, 480);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 1000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5, 5, 5);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x333333));

  // Shared geometry/material for all entities
  const geometry = new THREE.IcosahedronGeometry(0.3, 1);
  const material = new THREE.MeshPhongMaterial({ color: 0x00ffff });

  type Mesh3 = InstanceType<typeof THREE.Mesh>;
  const meshes: Mesh3[] = [];
  const scores: BenchmarkScore[] = [];
  let maxAt60 = 0;
  let maxAt30 = 0;

  const totalSteps = BENCHMARK_TIERS.length;

  for (let step = 0; step < totalSteps; step++) {
    const targetCount = BENCHMARK_TIERS[step];

    // Spawn entities up to target count
    while (meshes.length < targetCount) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40
      );
      scene.add(mesh);
      meshes.push(mesh);
    }

    // Warmup frames (discard timing)
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      animateMeshes(meshes);
      renderer.render(scene, camera);
      await waitFrame();
    }

    // Measure frames
    const frameTimes: number[] = [];
    for (let i = 0; i < MEASURE_FRAMES; i++) {
      const start = performance.now();
      animateMeshes(meshes);
      renderer.render(scene, camera);
      await waitFrame();
      const elapsed = performance.now() - start;
      frameTimes.push(elapsed);

      if (onProgress) {
        const currentFps = elapsed > 0 ? 1000 / elapsed : 60;
        onProgress(step, totalSteps, targetCount, Math.round(currentFps));
      }
    }

    const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const maxMs = Math.max(...frameTimes);
    const avgFps = avgMs > 0 ? 1000 / avgMs : 0;
    const minFps = maxMs > 0 ? 1000 / maxMs : 0;

    scores.push({
      entityCount: targetCount,
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: Math.round(minFps * 10) / 10,
    });

    if (avgFps >= 60) maxAt60 = targetCount;
    if (avgFps >= 30) maxAt30 = targetCount;

    // If we're already below 20fps, no point testing higher tiers
    if (avgFps < 20) break;
  }

  // Cleanup
  for (const mesh of meshes) {
    scene.remove(mesh);
  }
  geometry.dispose();
  material.dispose();
  renderer.dispose();
  canvas.remove();

  const gpuTier = deriveBenchmarkTier(maxAt60);

  return { maxAt60fps: maxAt60, maxAt30fps: maxAt30, gpuTier, scores };
}

function animateMeshes(meshes: { rotation: { x: number; y: number } }[]): void {
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].rotation.x += 0.01;
    meshes[i].rotation.y += 0.02;
  }
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function deriveBenchmarkTier(maxAt60: number): 'high' | 'medium' | 'low' | 'minimal' {
  if (maxAt60 >= 2000) return 'high';
  if (maxAt60 >= 500) return 'medium';
  if (maxAt60 >= 100) return 'low';
  return 'minimal';
}
