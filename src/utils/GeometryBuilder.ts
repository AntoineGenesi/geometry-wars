import * as THREE from 'three';

/**
 * Utility to create 3D tube-based geometry from edge definitions.
 * Creates a "neon tube" look with actual depth instead of flat 2D lines.
 */

const DEFAULT_TUBE_RADIUS = 0.022;
const DEFAULT_TUBE_SEGMENTS = 4;
const DEFAULT_RADIAL_SEGMENTS = 5;

/**
 * Create a tube-based mesh for a single edge segment.
 */
function createTubeSegment(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: THREE.ColorRepresentation,
  tubeRadius: number = DEFAULT_TUBE_RADIUS,
  emissive: boolean = true
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();

  if (length < 0.001) {
    // Skip zero-length segments
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshBasicMaterial({ visible: false });
    return new THREE.Mesh(geometry, material);
  }

  // Create a cylinder geometry oriented along Y axis
  const geometry = new THREE.CylinderGeometry(
    tubeRadius, tubeRadius, length, DEFAULT_RADIAL_SEGMENTS, 1, false
  );

  // Rotate cylinder to align with edge direction
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive ? color : 0x000000,
    emissiveIntensity: emissive ? 0.4 : 0,
    metalness: 0.3,
    roughness: 0.4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(midpoint);

  // Align cylinder with edge direction
  const up = new THREE.Vector3(0, 1, 0);
  direction.normalize();

  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(up, direction);
  mesh.quaternion.copy(quaternion);

  return mesh;
}

/**
 * Create a small sphere at a vertex (joint between tubes).
 */
function createJoint(
  position: THREE.Vector3,
  color: THREE.ColorRepresentation,
  radius: number = DEFAULT_TUBE_RADIUS * 1.2,
  emissive: boolean = true
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 6, 6);

  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive ? color : 0x000000,
    emissiveIntensity: emissive ? 0.4 : 0,
    metalness: 0.3,
    roughness: 0.4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);

  return mesh;
}

/**
 * Build a 3D prism frame from a list of edges.
 * Each edge is defined as [start, end] vectors.
 */
export function buildPrismFrame(
  edges: Array<[THREE.Vector3, THREE.Vector3]>,
  color: THREE.ColorRepresentation,
  tubeRadius: number = DEFAULT_TUBE_RADIUS,
  addJoints: boolean = true
): THREE.Group {
  const group = new THREE.Group();

  // Create tubes for each edge
  for (const [start, end] of edges) {
    const tube = createTubeSegment(start, end, color, tubeRadius);
    group.add(tube);
  }

  // Add joints at unique vertex positions
  if (addJoints) {
    const vertices = new Map<string, THREE.Vector3>();

    for (const [start, end] of edges) {
      const startKey = `${start.x.toFixed(4)},${start.y.toFixed(4)},${start.z.toFixed(4)}`;
      const endKey = `${end.x.toFixed(4)},${end.y.toFixed(4)},${end.z.toFixed(4)}`;

      if (!vertices.has(startKey)) {
        vertices.set(startKey, start.clone());
      }
      if (!vertices.has(endKey)) {
        vertices.set(endKey, end.clone());
      }
    }

    for (const pos of vertices.values()) {
      const joint = createJoint(pos, color, tubeRadius * 1.2);
      group.add(joint);
    }
  }

  return group;
}

/**
 * Build a 3D diamond/rhombus shape (4 edges).
 */
export function buildDiamond3D(
  size: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.08,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;

  // Front face vertices
  const topF = new THREE.Vector3(0, size, halfDepth);
  const rightF = new THREE.Vector3(size, 0, halfDepth);
  const bottomF = new THREE.Vector3(0, -size, halfDepth);
  const leftF = new THREE.Vector3(-size, 0, halfDepth);

  // Back face vertices
  const topB = new THREE.Vector3(0, size, -halfDepth);
  const rightB = new THREE.Vector3(size, 0, -halfDepth);
  const bottomB = new THREE.Vector3(0, -size, -halfDepth);
  const leftB = new THREE.Vector3(-size, 0, -halfDepth);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [topF, rightF], [rightF, bottomF], [bottomF, leftF], [leftF, topF],
    // Back face
    [topB, rightB], [rightB, bottomB], [bottomB, leftB], [leftB, topB],
    // Connecting edges
    [topF, topB], [rightF, rightB], [bottomF, bottomB], [leftF, leftB],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D square/box frame.
 */
export function buildSquare3D(
  size: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.08,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;

  // Front face vertices
  const tlF = new THREE.Vector3(-size, size, halfDepth);
  const trF = new THREE.Vector3(size, size, halfDepth);
  const brF = new THREE.Vector3(size, -size, halfDepth);
  const blF = new THREE.Vector3(-size, -size, halfDepth);

  // Back face vertices
  const tlB = new THREE.Vector3(-size, size, -halfDepth);
  const trB = new THREE.Vector3(size, size, -halfDepth);
  const brB = new THREE.Vector3(size, -size, -halfDepth);
  const blB = new THREE.Vector3(-size, -size, -halfDepth);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [tlF, trF], [trF, brF], [brF, blF], [blF, tlF],
    // Back face
    [tlB, trB], [trB, brB], [brB, blB], [blB, tlB],
    // Connecting edges
    [tlF, tlB], [trF, trB], [brF, brB], [blF, blB],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D triangle prism.
 */
export function buildTriangle3D(
  size: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.08,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;
  const h = size * 0.866; // Height of equilateral triangle

  // Front face vertices
  const topF = new THREE.Vector3(0, size, halfDepth);
  const blF = new THREE.Vector3(-h, -size * 0.5, halfDepth);
  const brF = new THREE.Vector3(h, -size * 0.5, halfDepth);

  // Back face vertices
  const topB = new THREE.Vector3(0, size, -halfDepth);
  const blB = new THREE.Vector3(-h, -size * 0.5, -halfDepth);
  const brB = new THREE.Vector3(h, -size * 0.5, -halfDepth);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [topF, blF], [blF, brF], [brF, topF],
    // Back face
    [topB, blB], [blB, brB], [brB, topB],
    // Connecting edges
    [topF, topB], [blF, blB], [brF, brB],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D polygon prism with N sides.
 */
export function buildPolygon3D(
  sides: number,
  radius: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.08,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];

  const frontVerts: THREE.Vector3[] = [];
  const backVerts: THREE.Vector3[] = [];

  for (let i = 0; i < sides; i++) {
    const angle = (i * Math.PI * 2) / sides - Math.PI / 2; // Start from top
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    frontVerts.push(new THREE.Vector3(x, y, halfDepth));
    backVerts.push(new THREE.Vector3(x, y, -halfDepth));
  }

  // Front and back faces
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    edges.push([frontVerts[i], frontVerts[next]]);
    edges.push([backVerts[i], backVerts[next]]);
    edges.push([frontVerts[i], backVerts[i]]);
  }

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D octahedron frame.
 */
export function buildOctahedron3D(
  size: number,
  color: THREE.ColorRepresentation,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const top = new THREE.Vector3(0, size, 0);
  const bottom = new THREE.Vector3(0, -size, 0);
  const front = new THREE.Vector3(0, 0, size);
  const back = new THREE.Vector3(0, 0, -size);
  const left = new THREE.Vector3(-size, 0, 0);
  const right = new THREE.Vector3(size, 0, 0);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Top pyramid
    [top, front], [top, back], [top, left], [top, right],
    // Bottom pyramid
    [bottom, front], [bottom, back], [bottom, left], [bottom, right],
    // Middle ring
    [front, right], [right, back], [back, left], [left, front],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D pinwheel shape (4 blades extending from center).
 */
export function buildPinwheel3D(
  bladeLength: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.04,
  tubeRadius: number = DEFAULT_TUBE_RADIUS * 0.8
): THREE.Group {
  const halfDepth = depth / 2;
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];

  const centerF = new THREE.Vector3(0, 0, halfDepth);
  const centerB = new THREE.Vector3(0, 0, -halfDepth);

  // Center connecting edge
  edges.push([centerF, centerB]);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const tipAngle = angle + Math.PI / 8; // Slight offset for pinwheel twist

    const cx = Math.cos(angle) * 0.05;
    const cy = Math.sin(angle) * 0.05;
    const tx = Math.cos(tipAngle) * bladeLength;
    const ty = Math.sin(tipAngle) * bladeLength;

    const baseF = new THREE.Vector3(cx, cy, halfDepth);
    const tipF = new THREE.Vector3(tx, ty, halfDepth);
    const baseB = new THREE.Vector3(cx, cy, -halfDepth);
    const tipB = new THREE.Vector3(tx, ty, -halfDepth);

    edges.push([centerF, baseF]);
    edges.push([centerB, baseB]);
    edges.push([baseF, tipF]);
    edges.push([baseB, tipB]);
    edges.push([tipF, tipB]);
    edges.push([baseF, baseB]);
  }

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D arrow/chevron shape (like player ship or rocket).
 */
export function buildChevron3D(
  length: number,
  halfWidth: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.06,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;

  // Front face vertices (in XZ plane, Y is up from surface)
  // Ship points along +Z
  const noseF = new THREE.Vector3(0, halfDepth, length * 0.5);
  const leftTailF = new THREE.Vector3(-halfWidth, halfDepth, -length * 0.5);
  const rightTailF = new THREE.Vector3(halfWidth, halfDepth, -length * 0.5);
  const centerF = new THREE.Vector3(0, halfDepth, -length * 0.25);

  // Back face vertices
  const noseB = new THREE.Vector3(0, -halfDepth, length * 0.5);
  const leftTailB = new THREE.Vector3(-halfWidth, -halfDepth, -length * 0.5);
  const rightTailB = new THREE.Vector3(halfWidth, -halfDepth, -length * 0.5);
  const centerB = new THREE.Vector3(0, -halfDepth, -length * 0.25);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face (chevron shape)
    [leftTailF, noseF], [noseF, rightTailF], [rightTailF, centerF], [centerF, leftTailF],
    // Back face
    [leftTailB, noseB], [noseB, rightTailB], [rightTailB, centerB], [centerB, leftTailB],
    // Connecting edges
    [noseF, noseB], [leftTailF, leftTailB], [rightTailF, rightTailB], [centerF, centerB],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build a 3D circle/ring frame (approximated with segments).
 */
export function buildCircle3D(
  radius: number,
  segments: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.04,
  tubeRadius: number = DEFAULT_TUBE_RADIUS * 0.8
): THREE.Group {
  const halfDepth = depth / 2;
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];

  const frontVerts: THREE.Vector3[] = [];
  const backVerts: THREE.Vector3[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i * Math.PI * 2) / segments;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    frontVerts.push(new THREE.Vector3(x, y, halfDepth));
    backVerts.push(new THREE.Vector3(x, y, -halfDepth));
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    edges.push([frontVerts[i], frontVerts[next]]);
    edges.push([backVerts[i], backVerts[next]]);
    // Only add connecting edges at intervals to avoid too many
    if (i % Math.max(1, Math.floor(segments / 8)) === 0) {
      edges.push([frontVerts[i], backVerts[i]]);
    }
  }

  return buildPrismFrame(edges, color, tubeRadius, false); // No extra joints for circles
}

/**
 * Build a 3D arrow/rocket shape.
 */
export function buildArrow3D(
  size: number,
  color: THREE.ColorRepresentation,
  depth: number = 0.06,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): THREE.Group {
  const halfDepth = depth / 2;

  // Arrow pointing up (+Y direction)
  const tipF = new THREE.Vector3(0, size, halfDepth);
  const leftWingF = new THREE.Vector3(-size * 0.6, -size * 0.4, halfDepth);
  const rightWingF = new THREE.Vector3(size * 0.6, -size * 0.4, halfDepth);
  const bodyLeftF = new THREE.Vector3(-size * 0.3, -size * 0.4, halfDepth);
  const bodyRightF = new THREE.Vector3(size * 0.3, -size * 0.4, halfDepth);
  const bottomLeftF = new THREE.Vector3(-size * 0.3, -size * 0.7, halfDepth);
  const bottomRightF = new THREE.Vector3(size * 0.3, -size * 0.7, halfDepth);

  const tipB = new THREE.Vector3(0, size, -halfDepth);
  const leftWingB = new THREE.Vector3(-size * 0.6, -size * 0.4, -halfDepth);
  const rightWingB = new THREE.Vector3(size * 0.6, -size * 0.4, -halfDepth);
  const bodyLeftB = new THREE.Vector3(-size * 0.3, -size * 0.4, -halfDepth);
  const bodyRightB = new THREE.Vector3(size * 0.3, -size * 0.4, -halfDepth);
  const bottomLeftB = new THREE.Vector3(-size * 0.3, -size * 0.7, -halfDepth);
  const bottomRightB = new THREE.Vector3(size * 0.3, -size * 0.7, -halfDepth);

  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [tipF, leftWingF], [tipF, rightWingF],
    [leftWingF, bodyLeftF], [rightWingF, bodyRightF],
    [bodyLeftF, bottomLeftF], [bodyRightF, bottomRightF],
    [bottomLeftF, bottomRightF],
    // Back face
    [tipB, leftWingB], [tipB, rightWingB],
    [leftWingB, bodyLeftB], [rightWingB, bodyRightB],
    [bodyLeftB, bottomLeftB], [bodyRightB, bottomRightB],
    [bottomLeftB, bottomRightB],
    // Connecting edges
    [tipF, tipB], [leftWingF, leftWingB], [rightWingF, rightWingB],
    [bodyLeftF, bodyLeftB], [bodyRightF, bodyRightB],
    [bottomLeftF, bottomLeftB], [bottomRightF, bottomRightB],
  ];

  return buildPrismFrame(edges, color, tubeRadius);
}

/**
 * Build two-part arrow shape for Repulsor (front and rear separate).
 */
export function buildRepulsorShape(
  size: number,
  frontColor: THREE.ColorRepresentation,
  rearColor: THREE.ColorRepresentation,
  depth: number = 0.06,
  tubeRadius: number = DEFAULT_TUBE_RADIUS
): { front: THREE.Group; rear: THREE.Group } {
  const halfDepth = depth / 2;

  // Repulsor pointing right (+X direction)
  // Front (pointed part)
  const tipF = new THREE.Vector3(size, 0, halfDepth);
  const frontTopF = new THREE.Vector3(0, size * 0.5, halfDepth);
  const frontBottomF = new THREE.Vector3(0, -size * 0.5, halfDepth);

  const tipB = new THREE.Vector3(size, 0, -halfDepth);
  const frontTopB = new THREE.Vector3(0, size * 0.5, -halfDepth);
  const frontBottomB = new THREE.Vector3(0, -size * 0.5, -halfDepth);

  const frontEdges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [tipF, frontTopF], [tipF, frontBottomF], [frontTopF, frontBottomF],
    // Back face
    [tipB, frontTopB], [tipB, frontBottomB], [frontTopB, frontBottomB],
    // Connecting
    [tipF, tipB], [frontTopF, frontTopB], [frontBottomF, frontBottomB],
  ];

  // Rear (triangle part)
  const rearTipF = new THREE.Vector3(-size, 0, halfDepth);
  const rearTopF = frontTopF.clone();
  const rearBottomF = frontBottomF.clone();

  const rearTipB = new THREE.Vector3(-size, 0, -halfDepth);
  const rearTopB = frontTopB.clone();
  const rearBottomB = frontBottomB.clone();

  const rearEdges: Array<[THREE.Vector3, THREE.Vector3]> = [
    // Front face
    [rearTipF, rearTopF], [rearTipF, rearBottomF], [rearTopF, rearBottomF],
    // Back face
    [rearTipB, rearTopB], [rearTipB, rearBottomB], [rearTopB, rearBottomB],
    // Connecting
    [rearTipF, rearTipB], [rearTopF, rearTopB], [rearBottomF, rearBottomB],
  ];

  return {
    front: buildPrismFrame(frontEdges, frontColor, tubeRadius),
    rear: buildPrismFrame(rearEdges, rearColor, tubeRadius),
  };
}
