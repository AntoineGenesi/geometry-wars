import * as THREE from 'three';

/**
 * PortalSurfaceMaterial — renders a portal ring directly onto the surface mesh.
 *
 * Applied to an overlay mesh that SHARES the surface geometry (same approach as
 * ZoneSurfaceMaterial for King of the Hill). The ring curves along the surface
 * because the shader paints on the actual surface geometry vertices rather than
 * projecting a flat shape from above.
 *
 * Usage:
 *   const mat = new PortalSurfaceMaterial(color);
 *   const overlay = new THREE.Mesh(surface.mesh.geometry, mat);
 *   overlay.renderOrder = 2;
 *   surface.group.add(overlay);
 *   // Each frame:
 *   mat.update(portalWorldCenter, time);
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uInnerRadius;
  uniform float uOuterRadius;
  uniform vec3 uColor;
  uniform float uTime;

  varying vec3 vWorldPos;

  void main() {
    float dist = distance(vWorldPos, uCenter);

    // Only render within ring band (with soft margins for anti-aliasing)
    float fadeMargin = (uOuterRadius - uInnerRadius) * 0.18;
    float innerFade = smoothstep(uInnerRadius - fadeMargin, uInnerRadius + fadeMargin, dist);
    float outerFade = 1.0 - smoothstep(uOuterRadius - fadeMargin, uOuterRadius + fadeMargin, dist);
    float inRing = innerFade * outerFade;

    if (inRing < 0.001) discard;

    // Peak brightness at ring midpoint
    float mid = (uInnerRadius + uOuterRadius) * 0.5;
    float ringT = 1.0 - abs(dist - mid) / ((uOuterRadius - uInnerRadius) * 0.5);
    ringT = max(0.0, ringT);

    // Gentle pulse
    float pulse = 0.75 + 0.25 * sin(uTime * 2.8);

    float alpha = ringT * ringT * 0.90 * pulse * inRing;

    if (alpha < 0.005) discard;

    // Brighten color for additive glow effect
    vec3 col = uColor * (1.4 + 0.6 * ringT * pulse);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class PortalSurfaceMaterial extends THREE.ShaderMaterial {
  constructor(color: THREE.Color) {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCenter:      { value: new THREE.Vector3() },
        uInnerRadius: { value: 0.8 },
        uOuterRadius: { value: 1.5 },
        uColor:       { value: color.clone() },
        uTime:        { value: 0 },
      },
    });

    this.customProgramCacheKey = () => 'portal-surface-material-v1';
  }

  /**
   * Update portal ring uniforms. Call every frame. Zero allocations.
   *
   * @param center    Portal center in world space (same space as surface.group.matrixWorld)
   * @param innerRadius Inner edge of the ring band in world units
   * @param outerRadius Outer edge of the ring band in world units
   * @param time      Elapsed time in seconds (for pulse animation)
   */
  update(
    center: THREE.Vector3,
    innerRadius: number,
    outerRadius: number,
    time: number,
  ): void {
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uInnerRadius.value = innerRadius;
    this.uniforms.uOuterRadius.value = outerRadius;
    this.uniforms.uTime.value = time;
  }
}
