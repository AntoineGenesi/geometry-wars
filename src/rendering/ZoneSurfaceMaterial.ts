import * as THREE from 'three';

/**
 * ZoneSurfaceMaterial — renders the KotH zone directly onto the surface mesh.
 *
 * This ShaderMaterial is applied to a mesh that shares geometry with the surface
 * mesh. It uses world-space distance from the zone center to shade the zone area,
 * creating a colored region painted on the surface itself rather than a floating
 * ring overlay.
 *
 * Visual design:
 *  - Zone interior: translucent cyan fill (gets brighter when player is inside)
 *  - Zone boundary: bright glowing ring at the zone edge
 *  - Soft fade just outside the boundary
 *  - Cyan → red as zone shrinks (danger feedback)
 *  - Pulsing animation + alarm flash when zone is nearly minimum
 *
 * Usage:
 *   const mat = new ZoneSurfaceMaterial();
 *   const overlayMesh = new THREE.Mesh(surface.mesh.geometry, mat);
 *   surface.group.add(overlayMesh);
 *   // Each frame:
 *   mat.updateZone(centerWorldPos, worldRadius, time, shrinkProgress, inZone);
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
  uniform vec3 uZoneCenter;
  uniform float uZoneRadius;
  uniform float uBoundaryWidth;
  uniform float uTime;
  uniform float uShrinkProgress; // 0 = full size, 1 = at minimum
  uniform int uInZone;           // 1 if player is inside the zone

  varying vec3 vWorldPos;

  void main() {
    float dist = distance(vWorldPos, uZoneCenter);

    // Normalized distance: 0 = center, 1 = zone edge
    float t = dist / uZoneRadius;

    // Discard fragments well outside the zone (avoid any overdraw)
    if (t > 1.25) discard;

    // Color: cyan → red as zone shrinks toward minimum
    float dangerT = clamp(uShrinkProgress, 0.0, 1.0);
    vec3 safeColor    = vec3(0.0, 1.0, 1.0);   // cyan
    vec3 dangerColor  = vec3(1.0, 0.15, 0.05); // red-orange
    vec3 innerColor   = mix(safeColor, dangerColor, dangerT * 0.55);
    vec3 borderColor  = mix(vec3(0.4, 1.0, 1.0), dangerColor, dangerT);

    // Pulse: gentle at normal, fast alarm when danger (shrink > 0.6)
    float slowPulse  = 0.85 + 0.15 * sin(uTime * 3.14159);
    float alarmPulse = dangerT > 0.6
      ? 0.6 + 0.4 * sin(uTime * 12.0)
      : 0.0;
    float pulse = max(slowPulse, alarmPulse);

    float alpha;
    vec3 color;

    float boundaryStart = 1.0 - uBoundaryWidth;

    if (t < boundaryStart) {
      // ── Zone interior fill ──────────────────────────────────────────────
      // Very translucent center, slightly more opaque toward the boundary.
      float fillT = t / max(boundaryStart, 0.001);
      alpha = mix(0.05, 0.18, fillT * fillT) * pulse;

      // Brighter when player is inside — positive reinforcement
      if (uInZone == 1) {
        alpha = mix(alpha, alpha * 2.0, 0.6);
      }

      // Alarm flash on danger level
      alpha += alarmPulse * 0.06;
      color = innerColor;

    } else if (t <= 1.0) {
      // ── Zone boundary ring ───────────────────────────────────────────────
      // Peak brightness at the center of the ring, fades at the edges.
      float ringT = (t - boundaryStart) / uBoundaryWidth;
      float ringBrightness = 1.0 - 4.0 * (ringT - 0.5) * (ringT - 0.5);
      ringBrightness = max(0.0, ringBrightness);

      alpha = ringBrightness * 0.85 * pulse;
      alpha += alarmPulse * 0.25;
      color = borderColor;

    } else {
      // ── Soft outer fade (t in [1.0, 1.25]) ──────────────────────────────
      float fadeT = (t - 1.0) / 0.25;
      alpha = (1.0 - fadeT) * (1.0 - fadeT) * 0.12 * pulse;
      color = borderColor;
    }

    if (alpha < 0.001) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

export class ZoneSurfaceMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uZoneCenter:     { value: new THREE.Vector3() },
        uZoneRadius:     { value: 1.0 },
        uBoundaryWidth:  { value: 0.08 }, // fraction of zone radius
        uTime:           { value: 0 },
        uShrinkProgress: { value: 0 },
        uInZone:         { value: 0 },
      },
    });

    // Prevent Three.js shader cache from reusing this program
    this.customProgramCacheKey = () => 'zone-surface-material-v1';
  }

  /**
   * Update zone uniforms. Call every frame. Zero allocations.
   *
   * @param center        Zone center in world space
   * @param radius        Zone radius in world units
   * @param time          Elapsed time in seconds (for animations)
   * @param shrinkProgress 0 = full size, 1 = at minimum (drives color shift)
   * @param inZone        Whether the player is currently inside the zone
   */
  updateZone(
    center: THREE.Vector3,
    radius: number,
    time: number,
    shrinkProgress: number,
    inZone: boolean,
  ): void {
    this.uniforms.uZoneCenter.value.copy(center);
    this.uniforms.uZoneRadius.value = radius;
    this.uniforms.uTime.value = time;
    this.uniforms.uShrinkProgress.value = shrinkProgress;
    this.uniforms.uInZone.value = inZone ? 1 : 0;
  }
}
