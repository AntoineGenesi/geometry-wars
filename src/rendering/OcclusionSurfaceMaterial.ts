import * as THREE from 'three'

/**
 * Pure math: compute the depth-faded alpha for a fragment at worldPos.
 *
 * A fragment between the camera and player (along the camera→player ray) within
 * `corridorRadius` world units of the ray is faded toward `minAlpha`.
 * Fragments outside the corridor or behind the camera / past the player are unchanged.
 *
 * Extracted as a pure function for unit testability — the GLSL shader mirrors this math.
 *
 * @param fragWorldPos   Fragment world-space position
 * @param cameraPos      Camera world-space position
 * @param playerPos      Player world-space position
 * @param currentAlpha   Alpha before fading
 * @param minAlpha       Target alpha when fully inside the corridor (default 0.08)
 * @param corridorRadius Lateral radius of the fade corridor in world units (default 2.0)
 * @returns Faded alpha
 */
export function computeFadeAlpha(
  fragWorldPos: THREE.Vector3,
  cameraPos: THREE.Vector3,
  playerPos: THREE.Vector3,
  currentAlpha: number,
  minAlpha: number,
  corridorRadius: number,
): number {
  const dx = playerPos.x - cameraPos.x
  const dy = playerPos.y - cameraPos.y
  const dz = playerPos.z - cameraPos.z
  const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (totalDist === 0) return currentAlpha

  // Normalized ray direction (camera → player)
  const rdx = dx / totalDist
  const rdy = dy / totalDist
  const rdz = dz / totalDist

  // Project fragment onto the ray
  const tfx = fragWorldPos.x - cameraPos.x
  const tfy = fragWorldPos.y - cameraPos.y
  const tfz = fragWorldPos.z - cameraPos.z
  const t = tfx * rdx + tfy * rdy + tfz * rdz
  const tNorm = t / totalDist

  // Only affect fragments strictly between camera (tNorm=0) and player (tNorm=1)
  if (tNorm <= 0.0 || tNorm >= 1.0) return currentAlpha

  // Lateral distance from the ray
  const clx = cameraPos.x + rdx * t
  const cly = cameraPos.y + rdy * t
  const clz = cameraPos.z + rdz * t
  const lx = fragWorldPos.x - clx
  const ly = fragWorldPos.y - cly
  const lz = fragWorldPos.z - clz
  const lateralDist = Math.sqrt(lx * lx + ly * ly + lz * lz)

  // smoothstep(0, corridorRadius, lateralDist): 0 at center, 1 at edge
  const x = Math.max(0, Math.min(1, lateralDist / corridorRadius))
  const smoothX = x * x * (3 - 2 * x)
  const fadeFactor = 1.0 - smoothX // 1 at center, 0 at edge

  // mix(currentAlpha, minAlpha, fadeFactor)
  return currentAlpha + fadeFactor * (minAlpha - currentAlpha)
}

export interface OcclusionSurfaceMaterialOptions extends THREE.MeshBasicMaterialParameters {
  /** Minimum alpha for fully occluding geometry. Default: 0.08 */
  minAlpha?: number
  /** Lateral corridor radius in world units. Faces outside fade to nothing. Default: 2.0 */
  corridorRadius?: number
}

/**
 * Drop-in replacement for MeshBasicMaterial with depth-based occlusion fade.
 *
 * Uses `onBeforeCompile` to inject a depth-fade pass into the MeshBasicMaterial
 * GLSL without replacing the whole shader. When `enabled=false`, output is
 * identical to the base MeshBasicMaterial — no shader branching cost in that case
 * because the uniform check short-circuits immediately.
 *
 * Usage:
 * ```ts
 * const mat = new OcclusionSurfaceMaterial({ color: 0x141440, transparent: true, opacity: 0.92 })
 * // each frame:
 * mat.setOcclusionParams(camera.position, player.position, isOccluded)
 * ```
 */
export class OcclusionSurfaceMaterial extends THREE.MeshBasicMaterial {
  // Pre-allocated vectors: copied into every frame, zero GC
  private readonly _cameraPos: THREE.Vector3 = new THREE.Vector3()
  private readonly _playerPos: THREE.Vector3 = new THREE.Vector3()

  // Uniform descriptors wired into the compiled shader
  private readonly _uniforms: {
    uCameraPos: { value: THREE.Vector3 }
    uPlayerPos: { value: THREE.Vector3 }
    uOcclusionEnabled: { value: boolean }
    uMinAlpha: { value: number }
    uCorridorRadius: { value: number }
  }

  constructor(params: OcclusionSurfaceMaterialOptions = {}) {
    const { minAlpha = 0.08, corridorRadius = 2.0, ...baseParams } = params
    super(baseParams)

    this._uniforms = {
      uCameraPos: { value: this._cameraPos },
      uPlayerPos: { value: this._playerPos },
      uOcclusionEnabled: { value: false },
      uMinAlpha: { value: minAlpha },
      uCorridorRadius: { value: corridorRadius },
    }

    const uniforms = this._uniforms

    this.onBeforeCompile = (shader) => {
      // Wire our uniforms into the program
      shader.uniforms.uCameraPos = uniforms.uCameraPos
      shader.uniforms.uPlayerPos = uniforms.uPlayerPos
      shader.uniforms.uOcclusionEnabled = uniforms.uOcclusionEnabled
      shader.uniforms.uMinAlpha = uniforms.uMinAlpha
      shader.uniforms.uCorridorRadius = uniforms.uCorridorRadius

      // --- Vertex shader: add vWorldPos varying ---
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'varying vec3 vWorldPos;\nvoid main() {',
      )
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      )

      // --- Fragment shader: declare uniforms + varying, apply depth fade ---
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        [
          'uniform vec3 uCameraPos;',
          'uniform vec3 uPlayerPos;',
          'uniform bool uOcclusionEnabled;',
          'uniform float uMinAlpha;',
          'uniform float uCorridorRadius;',
          'varying vec3 vWorldPos;',
          'void main() {',
        ].join('\n'),
      )

      // Inject depth-fade after dithering (gl_FragColor is fully computed at this point)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        [
          '#include <dithering_fragment>',
          'if (uOcclusionEnabled) {',
          '  vec3 _rayDir = normalize(uPlayerPos - uCameraPos);',
          '  float _totalDist = length(uPlayerPos - uCameraPos);',
          '  if (_totalDist > 0.0) {',
          '    float _t = dot(vWorldPos - uCameraPos, _rayDir);',
          '    float _tNorm = _t / _totalDist;',
          '    if (_tNorm > 0.0 && _tNorm < 1.0) {',
          '      vec3 _closest = uCameraPos + _rayDir * _t;',
          '      float _lateral = length(vWorldPos - _closest);',
          '      float _x = clamp(_lateral / uCorridorRadius, 0.0, 1.0);',
          '      float _fade = 1.0 - (_x * _x * (3.0 - 2.0 * _x));',
          '      gl_FragColor.a = mix(gl_FragColor.a, uMinAlpha, _fade);',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      )
    }

    // Prevent Three.js shader cache from sharing this program with vanilla MeshBasicMaterial
    this.customProgramCacheKey = () => 'occlusion-surface-material-v1'
  }

  /**
   * Update occlusion parameters. Call every frame before rendering.
   * Zero allocations — copies into pre-allocated vectors.
   *
   * @param cameraPos World-space camera position
   * @param playerPos World-space player position
   * @param enabled   Whether to activate depth fade this frame
   */
  setOcclusionParams(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, enabled: boolean): void {
    this._cameraPos.copy(cameraPos)
    this._playerPos.copy(playerPos)
    this._uniforms.uOcclusionEnabled.value = enabled
  }
}
