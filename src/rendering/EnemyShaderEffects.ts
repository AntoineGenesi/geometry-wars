import * as THREE from 'three';

/**
 * EnemyShaderEffects - Enhances enemy InstancedMesh materials with time-based
 * shader effects via onBeforeCompile injection.
 *
 * Each enemy type gets a distinct visual style:
 * - Lava Lamp: smooth sin-based vertex displacement that makes surfaces flow
 * - Crystal: sharp angular facet highlighting with emissive pulse
 * - Pulse: rhythmic scale breathing with inner pattern modulation
 * - Nebula: noise-based vertex displacement for cloud-like fuzzy edges
 * - Art Piece: color-shifting outer shell with complex wave patterns
 *
 * All effects are GPU-side (vertex/fragment shader), so they're nearly free
 * performance-wise. The only JS cost is updating the shared time uniform once
 * per frame.
 */

// ---------------------------------------------------------------------------
// Effect type definitions
// ---------------------------------------------------------------------------

export type EnemyShaderStyle =
  | 'lava'      // Wanderer, Helix — organic flowing wobble
  | 'crystal'   // Grunt, Weaver — sharp faceted pulse
  | 'pulse'     // Spinner, Rocket — rhythmic breathing
  | 'nebula'    // Fractal, Swarm — cloud-like fuzzy edges
  | 'artpiece'  // Boss types — color-shifting complex waves
  | 'none';     // No shader effect

/** Map enemy type names to their shader style. */
const ENEMY_SHADER_MAP: Record<string, EnemyShaderStyle> = {
  // Lava lamp style — organic, flowing
  Wanderer: 'lava',
  Helix: 'lava',
  Lurker: 'lava',

  // Crystal style — sharp, faceted
  Grunt: 'crystal',
  Weaver: 'crystal',
  Duck: 'crystal',

  // Pulse style — breathing, rhythmic
  Spinner: 'pulse',
  SpinnerSpawn: 'pulse',
  Rocket: 'pulse',
  Neutron: 'pulse',

  // Nebula style — cloud-like, fuzzy
  Virus: 'nebula',
  Orbiter: 'nebula',
  Splitter: 'nebula',
};

/** Get the shader style for an enemy type. */
export function getEnemyShaderStyle(typeName: string): EnemyShaderStyle {
  return ENEMY_SHADER_MAP[typeName] ?? 'none';
}

// ---------------------------------------------------------------------------
// Shared time uniform — updated once per frame from the game loop
// ---------------------------------------------------------------------------

/** Global time value that all shader effects read. Updated by updateShaderTime(). */
let _shaderTime = 0;

/**
 * Call once per frame from the game loop to update the global shader time.
 * All enhanced materials automatically read this value.
 */
export function updateShaderTime(totalTime: number): void {
  _shaderTime = totalTime;
}

// ---------------------------------------------------------------------------
// Material enhancement
// ---------------------------------------------------------------------------

/** Track which materials have been enhanced to avoid double-injection. */
const _enhancedMaterials = new WeakSet<THREE.Material>();

/**
 * Enhance a material with shader effects for the given enemy type.
 * Wraps the existing onBeforeCompile (which handles per-instance opacity)
 * with additional vertex/fragment code for the visual style.
 *
 * This is called from EnemyInstanceManager.createBatch() after the material
 * is created, and also wraps around the existing opacity injection.
 *
 * @param material  The MeshStandardMaterial to enhance.
 * @param style     The visual style to apply.
 * @param baseColor The enemy type's base color (for color-shift effects).
 */
export function enhanceMaterialWithShaderEffect(
  material: THREE.MeshStandardMaterial,
  style: EnemyShaderStyle,
  baseColor: THREE.Color,
): void {
  if (style === 'none') return;
  if (_enhancedMaterials.has(material)) return;
  _enhancedMaterials.add(material);

  // Store the existing onBeforeCompile (which handles instanceOpacity)
  const existingOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    // First run the existing onBeforeCompile (opacity injection)
    if (existingOnBeforeCompile) {
      existingOnBeforeCompile.call(material, shader, {} as THREE.WebGLRenderer);
    }

    // Add time uniform
    shader.uniforms['uTime'] = { value: 0 };
    shader.uniforms['uBaseColor'] = { value: baseColor.clone() };

    // Inject vertex shader modifications based on style
    injectVertexShader(shader, style);

    // Inject fragment shader modifications based on style
    injectFragmentShader(shader, style);

    // Store shader reference for time updates
    _activeShaders.push(shader);
  };

  // Force material to recompile with new shader
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Active shader tracking for uniform updates
// ---------------------------------------------------------------------------

const _activeShaders: THREE.WebGLProgramParametersWithUniforms[] = [];

/**
 * Update time uniform on all active enhanced shaders.
 * Call once per frame after updateShaderTime().
 */
export function flushShaderUniforms(): void {
  for (let i = _activeShaders.length - 1; i >= 0; i--) {
    const shader = _activeShaders[i];
    if (shader.uniforms['uTime']) {
      shader.uniforms['uTime'].value = _shaderTime;
    }
  }
}

// ---------------------------------------------------------------------------
// Vertex shader injection
// ---------------------------------------------------------------------------

function injectVertexShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  style: EnemyShaderStyle,
): void {
  // Add uniform declarations at the top of main()
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    `uniform float uTime;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;
void main() {`,
  );

  // After the position/normal includes, apply vertex displacement
  const displacementCode = getVertexDisplacement(style);
  if (displacementCode) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vLocalPosition = transformed;
  ${displacementCode}`,
    );
  }

  // Pass world normal to fragment shader
  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
  vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`,
  );
}

function getVertexDisplacement(style: EnemyShaderStyle): string | null {
  switch (style) {
    case 'lava':
      // Smooth organic flowing displacement — lava lamp effect
      // Uses layered sin waves at different frequencies and phases
      return `
  float wave1 = sin(transformed.x * 8.0 + uTime * 2.0) * 0.03;
  float wave2 = sin(transformed.y * 6.0 + uTime * 1.5 + 1.0) * 0.025;
  float wave3 = cos(transformed.z * 7.0 + uTime * 1.8 + 2.5) * 0.02;
  float wave4 = sin((transformed.x + transformed.y) * 5.0 + uTime * 2.5) * 0.015;
  vec3 displacement = objectNormal * (wave1 + wave2 + wave3 + wave4);
  transformed += displacement;`;

    case 'crystal':
      // Sharp angular displacement — subtle facet shimmering
      // Uses step functions for sharp transitions
      return `
  float facet = step(0.5, fract(transformed.x * 12.0 + uTime * 0.5))
              * step(0.5, fract(transformed.y * 12.0 - uTime * 0.3));
  float crystalPulse = sin(uTime * 3.0) * 0.5 + 0.5;
  vec3 crystalDisp = objectNormal * facet * crystalPulse * 0.015;
  transformed += crystalDisp;`;

    case 'pulse':
      // Rhythmic breathing — uniform scale modulation
      // The instanced mesh already handles scale via matrix, so we add
      // a secondary per-vertex wave that creates a "bulge" effect
      return `
  float breathe = sin(uTime * 4.0) * 0.04;
  float innerGrow = sin(uTime * 6.0 + length(transformed) * 10.0) * 0.02;
  transformed *= 1.0 + breathe + innerGrow;`;

    case 'nebula':
      // Cloud-like fuzzy displacement — different frequencies per axis
      return `
  float n1 = sin(transformed.x * 10.0 + uTime * 1.2) * cos(transformed.y * 8.0 + uTime * 0.8);
  float n2 = cos(transformed.z * 9.0 - uTime * 1.5) * sin(transformed.x * 7.0 + uTime * 1.0);
  float n3 = sin((transformed.x + transformed.z) * 6.0 + uTime * 2.0);
  vec3 nebulaDisp = objectNormal * (n1 * 0.04 + n2 * 0.03 + n3 * 0.02);
  transformed += nebulaDisp;`;

    case 'artpiece':
      // Complex multi-wave displacement for boss enemies
      return `
  float art1 = sin(transformed.x * 4.0 + uTime * 1.5) * cos(transformed.y * 3.0 + uTime);
  float art2 = cos(transformed.z * 5.0 + uTime * 2.0) * sin(transformed.x * 6.0 - uTime * 0.7);
  float art3 = sin(length(transformed) * 8.0 - uTime * 3.0) * 0.5;
  vec3 artDisp = objectNormal * (art1 * 0.03 + art2 * 0.025 + art3 * 0.02);
  transformed += artDisp;`;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fragment shader injection
// ---------------------------------------------------------------------------

function injectFragmentShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  style: EnemyShaderStyle,
): void {
  // Add varyings and uniforms at the top of fragment main
  shader.fragmentShader = shader.fragmentShader.replace(
    'void main() {',
    `uniform float uTime;
uniform vec3 uBaseColor;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;
void main() {`,
  );

  // Inject color modification after the standard color computation
  const fragCode = getFragmentModification(style);
  if (fragCode) {
    // Inject just before the final dithering pass
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `${fragCode}
  #include <dithering_fragment>`,
    );
  }
}

function getFragmentModification(style: EnemyShaderStyle): string | null {
  switch (style) {
    case 'lava':
      // Warm color shifting — hue oscillates through orange/magenta
      return `
  float lavaHue = sin(uTime * 1.5 + vLocalPosition.x * 5.0) * 0.15;
  float lavaGlow = sin(uTime * 2.0 + vLocalPosition.y * 4.0) * 0.5 + 0.5;
  gl_FragColor.rgb += uBaseColor * lavaHue;
  gl_FragColor.rgb += vec3(0.15, 0.05, 0.1) * lavaGlow;`;

    case 'crystal':
      // Sharp emissive spikes — facets flash brightly at intervals
      return `
  float facetFlash = pow(max(0.0, sin(uTime * 5.0 + vLocalPosition.x * 20.0)), 8.0);
  gl_FragColor.rgb += uBaseColor * facetFlash * 0.4;
  float edgeGlow = 1.0 - abs(dot(normalize(vWorldNormal), vec3(0.0, 0.0, 1.0)));
  gl_FragColor.rgb += uBaseColor * pow(edgeGlow, 3.0) * 0.3;`;

    case 'pulse':
      // Inner pattern — concentric rings that grow and shrink
      return `
  float dist = length(vLocalPosition);
  float rings = sin(dist * 30.0 - uTime * 8.0) * 0.5 + 0.5;
  float ringMask = smoothstep(0.4, 0.6, rings);
  gl_FragColor.rgb += uBaseColor * ringMask * 0.2;
  float corePulse = sin(uTime * 4.0) * 0.5 + 0.5;
  gl_FragColor.rgb += vec3(0.1) * corePulse;`;

    case 'nebula':
      // Color cycling — hue rotates through cyan/magenta/green
      return `
  float nebulaPhase = uTime * 0.8 + vLocalPosition.x * 3.0;
  vec3 nebColor1 = vec3(0.2, 0.5, 1.0);
  vec3 nebColor2 = vec3(1.0, 0.2, 0.8);
  vec3 nebColor3 = vec3(0.3, 1.0, 0.4);
  float t1 = sin(nebulaPhase) * 0.5 + 0.5;
  float t2 = sin(nebulaPhase + 2.094) * 0.5 + 0.5;
  vec3 nebMix = nebColor1 * t1 + nebColor2 * t2 + nebColor3 * (1.0 - t1 - t2 + t1 * t2);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, nebMix, 0.25);
  float cloudEdge = sin(vLocalPosition.y * 15.0 + uTime * 2.0) * 0.5 + 0.5;
  gl_FragColor.a *= 0.85 + cloudEdge * 0.15;`;

    case 'artpiece':
      // Complex color shifting — iridescent surface
      return `
  float iri = dot(normalize(vWorldNormal), normalize(vec3(sin(uTime), cos(uTime * 0.7), 0.5)));
  vec3 iriColor = vec3(
    sin(iri * 6.28 + 0.0) * 0.5 + 0.5,
    sin(iri * 6.28 + 2.094) * 0.5 + 0.5,
    sin(iri * 6.28 + 4.188) * 0.5 + 0.5
  );
  gl_FragColor.rgb = mix(gl_FragColor.rgb, iriColor, 0.3);
  float artPulse = sin(uTime * 2.0) * 0.15 + 0.85;
  gl_FragColor.rgb *= artPulse;`;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Remove all tracked shaders (call on dispose). */
export function clearShaderTracking(): void {
  _activeShaders.length = 0;
}
