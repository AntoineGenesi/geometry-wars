/**
 * Generate test meshes for multi-mesh registry testing.
 * Creates simple geometric shapes at various poly counts (OBJ format only).
 */

import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../public/meshes');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Export a mesh to OBJ format.
 */
function exportOBJ(mesh, filename) {
  const exporter = new OBJExporter();
  const objData = exporter.parse(mesh);
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, objData);

  const triCount = mesh.geometry.index
    ? mesh.geometry.index.count / 3
    : mesh.geometry.attributes.position.count / 3;

  console.log(`✓ Generated ${filename} (~${Math.round(triCount)} triangles)`);
}

/**
 * Create test meshes at various poly counts.
 */
function generateTestMeshes() {
  console.log('Generating test meshes...\n');

  // 1. Sphere (~1k triangles)
  const sphereGeo = new THREE.SphereGeometry(1, 16, 16);
  const sphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial());
  exportOBJ(sphere, 'sphere-simple.obj');

  // 2. Torus (~5k triangles)
  const torusGeo = new THREE.TorusGeometry(1, 0.4, 32, 64);
  const torus = new THREE.Mesh(torusGeo, new THREE.MeshBasicMaterial());
  exportOBJ(torus, 'torus.obj');

  // 3. Knot (~10k triangles)
  const knotGeo = new THREE.TorusKnotGeometry(1, 0.3, 128, 32);
  const knot = new THREE.Mesh(knotGeo, new THREE.MeshBasicMaterial());
  exportOBJ(knot, 'knot.obj');

  // 4. Icosahedron subdivided (~20k triangles)
  const icoGeo = new THREE.IcosahedronGeometry(1, 4); // 4 subdivisions
  const ico = new THREE.Mesh(icoGeo, new THREE.MeshBasicMaterial());
  exportOBJ(ico, 'bunny.obj');

  // 5. High-poly sphere (~50k triangles)
  const dragonGeo = new THREE.SphereGeometry(1, 128, 128);
  const dragon = new THREE.Mesh(dragonGeo, new THREE.MeshBasicMaterial());
  exportOBJ(dragon, 'dragon.obj');

  console.log('\n✓ All test meshes generated successfully!');
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

// Run
try {
  generateTestMeshes();
} catch (err) {
  console.error('Error generating meshes:', err);
  process.exit(1);
}
