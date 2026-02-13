import { Surface, SurfaceConfig } from './Surface'
import { SphereSurface, SphereConfig } from './SphereSurface'
import { CubeSurface, CubeConfig } from './CubeSurface'
import { PillSurface, PillConfig } from './PillSurface'
import { PipeSurface, PipeConfig } from './PipeSurface'
import { TorusSurface, TorusConfig } from './TorusSurface'
import { PeanutSurface, PeanutConfig } from './PeanutSurface'
import { CapsuleSurface, CapsuleConfig } from './CapsuleSurface'
import { IcosahedronSurface, IcosahedronConfig } from './IcosahedronSurface'
import { MobiusSurface, MobiusConfig } from './MobiusSurface'
import { SphereWithTunnelSurface, SphereWithTunnelConfig } from './SphereWithTunnelSurface'
import { CubeRingSurface, CubeRingConfig } from './CubeRingSurface'
import { CubeWithTunnelSurface, CubeWithTunnelConfig } from './CubeWithTunnelSurface'
import { MobiusBevelSurface, MobiusBevelConfig } from './MobiusBevelSurface'
import { LoadedMeshSurface, LoadedMeshConfig } from './LoadedMeshSurface'
import { loadMeshFromURL, loadMeshFromFile } from '../loaders/MeshLoader'

export type SurfaceType =
  | 'sphere'
  | 'cube'
  | 'pill'
  | 'pipe'
  | 'torus'
  | 'peanut'
  | 'capsule'
  | 'icosahedron'
  | 'mobius'
  | 'sphere-tunnel'
  | 'cube-ring'
  | 'cube-tunnel'
  | 'mobius-bevel'
  | 'custom'

export interface CustomMeshConfig extends SurfaceConfig {
  meshSource: string | File;  // URL or File object
  targetRadius?: number;       // normalization size (default: 8)
}

export type SurfaceConfigMap = {
  sphere: SphereConfig
  cube: CubeConfig
  pill: PillConfig
  pipe: PipeConfig
  torus: TorusConfig
  peanut: PeanutConfig
  capsule: CapsuleConfig
  icosahedron: IcosahedronConfig
  mobius: MobiusConfig
  'sphere-tunnel': SphereWithTunnelConfig
  'cube-ring': CubeRingConfig
  'cube-tunnel': CubeWithTunnelConfig
  'mobius-bevel': MobiusBevelConfig
  custom: CustomMeshConfig
}

export class SurfaceFactory {
  static async create<T extends SurfaceType>(
    type: T,
    config?: SurfaceConfigMap[T]
  ): Promise<Surface> {
    // Custom mesh loading is async
    if (type === 'custom') {
      const customConfig = config as CustomMeshConfig;
      if (!customConfig || !customConfig.meshSource) {
        throw new Error('Custom mesh requires meshSource in config');
      }

      const targetRadius = customConfig.targetRadius ?? 8;

      // Enforce poly-count limit
      const loadedMesh = typeof customConfig.meshSource === 'string'
        ? await loadMeshFromURL(customConfig.meshSource, targetRadius)
        : await loadMeshFromFile(customConfig.meshSource, targetRadius);

      if (loadedMesh.triangleCount > 100000) {
        throw new Error(`Mesh too large: ${loadedMesh.triangleCount} triangles (max: 100,000)`);
      }

      return new LoadedMeshSurface(loadedMesh, customConfig);
    }

    // All built-in surfaces are synchronous
    switch (type) {
      case 'sphere':
        return new SphereSurface(config as SphereConfig)
      case 'cube':
        return new CubeSurface(config as CubeConfig)
      case 'pill':
        return new PillSurface(config as PillConfig)
      case 'pipe':
        return new PipeSurface(config as PipeConfig)
      case 'torus':
        return new TorusSurface(config as TorusConfig)
      case 'peanut':
        return new PeanutSurface(config as PeanutConfig)
      case 'capsule':
        return new CapsuleSurface(config as CapsuleConfig)
      case 'icosahedron':
        return new IcosahedronSurface(config as IcosahedronConfig)
      case 'mobius':
        return new MobiusSurface(config as MobiusConfig)
      case 'sphere-tunnel':
        return new SphereWithTunnelSurface(config as SphereWithTunnelConfig)
      case 'cube-ring':
        return new CubeRingSurface(config as CubeRingConfig)
      case 'cube-tunnel':
        return new CubeWithTunnelSurface(config as CubeWithTunnelConfig)
      case 'mobius-bevel':
        return new MobiusBevelSurface(config as MobiusBevelConfig)
      default:
        throw new Error(`Unknown surface type: ${type}`)
    }
  }

  static getAvailableTypes(): SurfaceType[] {
    return ['sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut', 'capsule', 'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel', 'custom']
  }
}
