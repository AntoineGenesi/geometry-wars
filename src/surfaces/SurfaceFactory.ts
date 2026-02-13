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

export interface CustomMeshConfig extends LoadedMeshConfig {
  /** URL or File object for the mesh source */
  meshSource: string | File;
  /** Optional target radius for normalization (default: 8) */
  targetRadius?: number;
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
  static create<T extends SurfaceType>(
    type: T,
    config?: SurfaceConfigMap[T]
  ): Surface {
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
    return ['sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut', 'capsule', 'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel']
  }

  /**
   * Create a custom mesh surface (async).
   * This is separate from create() to avoid breaking existing synchronous call sites.
   *
   * @param config - Custom mesh configuration with meshSource (URL or File)
   * @returns Promise resolving to a LoadedMeshSurface
   */
  static async createCustom(config: CustomMeshConfig): Promise<Surface> {
    const targetRadius = config.targetRadius ?? 8;

    // Load the mesh
    const loadedMesh = typeof config.meshSource === 'string'
      ? await loadMeshFromURL(config.meshSource, targetRadius)
      : await loadMeshFromFile(config.meshSource, targetRadius);

    // Validate triangle count
    if (loadedMesh.triangleCount > 100000) {
      throw new Error(
        `Mesh too large: ${loadedMesh.triangleCount} triangles (max: 100,000)`
      );
    }

    return new LoadedMeshSurface(loadedMesh, config);
  }
}
