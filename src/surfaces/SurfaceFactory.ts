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
}
