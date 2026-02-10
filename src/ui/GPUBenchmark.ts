/**
 * GPU Benchmark - measures max sustainable entity counts at various FPS targets.
 *
 * Uses InstancedMesh rendering (matching real gameplay) to provide accurate
 * performance numbers. Each tier uses a single InstancedMesh with per-instance
 * transforms updated via a dummy matrix each frame, plus a second instanced
 * batch to simulate mixed enemy types (2 draw calls total, like real gameplay).
 *
 * Previous version used individual Mesh objects (one draw call per entity),
 * which severely underestimated actual game performance. At 5K entities the old
 * benchmark reported ~54 FPS due to 5000 draw calls, while real gameplay with
 * InstancedMesh batching would perform significantly better.
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
const BENCHMARK_TIERS = [100, 500, 1000, 2000, 5000, 10000];

/** Frames to measure at each tier after warmup */
const MEASURE_FRAMES = 60;
/** Warmup frames to skip at each tier */
const WARMUP_FRAMES = 15;

/**
 * Run a GPU benchmark using InstancedMesh rendering (matching real game performance).
 *
 * Creates a temporary canvas + Three.js renderer, renders increasing numbers of
 * instanced entities, and measures sustained FPS at each level. Uses 2 InstancedMesh
 * batches (simulating 2 enemy types) with per-instance matrix updates each frame,
 * which closely matches the actual rendering pipeline in gameplay.
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

  // Two geometry types to simulate mixed enemy batches (like real gameplay)
  const geometry1 = new THREE.IcosahedronGeometry(0.3, 1);
  const geometry2 = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const material1 = new THREE.MeshPhongMaterial({ color: 0x00ffff });
  const material2 = new THREE.MeshPhongMaterial({ color: 0xff4488 });

  // Pre-allocate reusable matrix and position for per-instance updates
  const tempMatrix = new THREE.Matrix4();
  const tempPos = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3(1, 1, 1);

  // We store initial random positions for animation
  const maxCount = BENCHMARK_TIERS[BENCHMARK_TIERS.length - 1];
  const positions: Float32Array = new Float32Array(maxCount * 3);
  for (let i = 0; i < maxCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
  }

  // Create InstancedMesh objects at max capacity. We control visible count via .count
  const instancedMesh1 = new THREE.InstancedMesh(geometry1, material1, maxCount);
  const instancedMesh2 = new THREE.InstancedMesh(geometry2, material2, maxCount);
  instancedMesh1.count = 0;
  instancedMesh2.count = 0;
  scene.add(instancedMesh1);
  scene.add(instancedMesh2);

  // Initialize all instance matrices
  for (let i = 0; i < maxCount; i++) {
    tempPos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    tempMatrix.compose(tempPos, tempQuat, tempScale);
    instancedMesh1.setMatrixAt(i, tempMatrix);
    instancedMesh2.setMatrixAt(i, tempMatrix);
  }
  instancedMesh1.instanceMatrix.needsUpdate = true;
  instancedMesh2.instanceMatrix.needsUpdate = true;

  let animFrame = 0;
  const scores: BenchmarkScore[] = [];
  let maxAt60 = 0;
  let maxAt30 = 0;

  const totalSteps = BENCHMARK_TIERS.length;

  for (let step = 0; step < totalSteps; step++) {
    const targetCount = BENCHMARK_TIERS[step];

    // Split entities between two batches (70/30 split like typical gameplay)
    const batch1Count = Math.ceil(targetCount * 0.7);
    const batch2Count = targetCount - batch1Count;
    instancedMesh1.count = batch1Count;
    instancedMesh2.count = batch2Count;

    // Warmup frames (discard timing)
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      animFrame++;
      animateInstances(instancedMesh1, instancedMesh2, positions, batch1Count, batch2Count, animFrame, tempMatrix, tempPos, tempQuat, tempScale);
      renderer.render(scene, camera);
      await waitFrame();
    }

    // Measure frames
    const frameTimes: number[] = [];
    for (let i = 0; i < MEASURE_FRAMES; i++) {
      const start = performance.now();
      animFrame++;
      animateInstances(instancedMesh1, instancedMesh2, positions, batch1Count, batch2Count, animFrame, tempMatrix, tempPos, tempQuat, tempScale);
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
  scene.remove(instancedMesh1);
  scene.remove(instancedMesh2);
  instancedMesh1.dispose();
  instancedMesh2.dispose();
  geometry1.dispose();
  geometry2.dispose();
  material1.dispose();
  material2.dispose();
  renderer.dispose();
  canvas.remove();

  const gpuTier = deriveBenchmarkTier(maxAt60);

  return { maxAt60fps: maxAt60, maxAt30fps: maxAt30, gpuTier, scores };
}

/**
 * Update per-instance transforms each frame to simulate real entity movement.
 * This is the per-frame CPU work that mirrors what happens in the real game:
 * each entity's position is updated and written to the instance matrix buffer.
 */
function animateInstances(
  mesh1: InstanceType<typeof import('three').InstancedMesh>,
  mesh2: InstanceType<typeof import('three').InstancedMesh>,
  positions: Float32Array,
  count1: number,
  count2: number,
  frame: number,
  tempMatrix: InstanceType<typeof import('three').Matrix4>,
  tempPos: InstanceType<typeof import('three').Vector3>,
  tempQuat: InstanceType<typeof import('three').Quaternion>,
  tempScale: InstanceType<typeof import('three').Vector3>,
): void {
  const t = frame * 0.02;

  // Update batch 1 instances
  for (let i = 0; i < count1; i++) {
    const idx = i * 3;
    tempPos.set(
      positions[idx] + Math.sin(t + i * 0.1) * 0.5,
      positions[idx + 1] + Math.cos(t + i * 0.13) * 0.5,
      positions[idx + 2] + Math.sin(t * 0.7 + i * 0.07) * 0.3,
    );
    tempQuat.setFromAxisAngle(tempScale.set(0, 1, 0), t + i);
    tempScale.set(1, 1, 1);
    tempMatrix.compose(tempPos, tempQuat, tempScale);
    mesh1.setMatrixAt(i, tempMatrix);
  }
  mesh1.instanceMatrix.needsUpdate = true;

  // Update batch 2 instances (offset into positions array)
  for (let i = 0; i < count2; i++) {
    const srcIdx = count1 + i;
    const idx = srcIdx * 3;
    tempPos.set(
      positions[idx] + Math.cos(t + srcIdx * 0.11) * 0.5,
      positions[idx + 1] + Math.sin(t + srcIdx * 0.09) * 0.5,
      positions[idx + 2] + Math.cos(t * 0.6 + srcIdx * 0.08) * 0.3,
    );
    tempQuat.setFromAxisAngle(tempScale.set(1, 0, 0), t + srcIdx);
    tempScale.set(1, 1, 1);
    tempMatrix.compose(tempPos, tempQuat, tempScale);
    mesh2.setMatrixAt(i, tempMatrix);
  }
  mesh2.instanceMatrix.needsUpdate = true;
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function deriveBenchmarkTier(maxAt60: number): 'high' | 'medium' | 'low' | 'minimal' {
  if (maxAt60 >= 5000) return 'high';
  if (maxAt60 >= 1000) return 'medium';
  if (maxAt60 >= 250) return 'low';
  return 'minimal';
}
