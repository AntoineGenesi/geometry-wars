import type { LanGameMode } from '../ui/StartMenu';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

export interface QuickStartConfig {
  enabled: boolean;
  surface?: SurfaceType;
  seed?: number;
  gameMode?: LanGameMode;
  customMeshSource?: string;
  error?: string;
}

const BUILT_IN_SURFACES: SurfaceType[] = [
  'sphere',
  'cube',
  'pill',
  'pipe',
  'torus',
  'peanut',
  'capsule',
  'icosahedron',
  'mobius',
  'sphere-tunnel',
  'cube-ring',
  'cube-tunnel',
  'flat-arena',
];

function isSupportedMeshPath(meshPath: string): boolean {
  const lower = meshPath.toLowerCase();
  const supportedExtension = lower.endsWith('.obj') || lower.endsWith('.glb') || lower.endsWith('.gltf');
  return supportedExtension && (meshPath.startsWith('/meshes/') || meshPath.startsWith('./meshes/'));
}

export function parseQuickStartConfig(search: string | URLSearchParams): QuickStartConfig {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;

  if (params.get('quickStart') !== 'true') return { enabled: false };

  const requestedSurface = (params.get('surface') || 'sphere') as SurfaceType;
  const seedParam = params.get('seed');
  const seed = seedParam ? parseInt(seedParam, 10) : undefined;
  const gameMode = (params.get('gameMode') ?? undefined) as LanGameMode | undefined;

  if (requestedSurface === 'custom') {
    const mesh = params.get('mesh') || '';
    if (!mesh) {
      return {
        enabled: true,
        surface: 'custom',
        seed,
        gameMode,
        error: 'quickStart custom surface requires a local mesh query parameter, for example ?surface=custom&mesh=/meshes/cup.obj',
      };
    }
    if (!isSupportedMeshPath(mesh)) {
      return {
        enabled: true,
        surface: 'custom',
        seed,
        gameMode,
        error: `Unsupported quickStart custom mesh path: ${mesh}. Use a local /meshes/*.obj, .glb, or .gltf asset.`,
      };
    }
    return { enabled: true, surface: 'custom', seed, gameMode, customMeshSource: mesh };
  }

  if (!BUILT_IN_SURFACES.includes(requestedSurface)) {
    return {
      enabled: true,
      surface: 'sphere',
      seed,
      gameMode,
      error: `Unknown quickStart surface: ${requestedSurface}`,
    };
  }

  return { enabled: true, surface: requestedSurface, seed, gameMode };
}

