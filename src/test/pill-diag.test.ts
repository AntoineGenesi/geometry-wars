import { describe, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { HalfEdgeMesh } from '../surfaces/geodesic/HalfEdgeMesh';
import { worldDirToBarycentric, worldToBarycentric } from '../surfaces/geodesic/BarycentricUtils';
import { FaceWalker } from '../surfaces/geodesic/FaceWalker';
import { GeodesicSurface } from '../surfaces/geodesic/GeodesicSurface';

describe('Pill seam diagnostic', () => {
  it('check if face 934 and 2322 are connected by twin edge', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);

    const halfEdgeMesh: HalfEdgeMesh = meshSurface.geodesic.halfEdge;
    const halfEdges = halfEdgeMesh.halfEdges;
    const faces = halfEdgeMesh.faces;

    console.log(`\n=== Face 934 edges ===`);
    for (let e = 0; e < 3; e++) {
      const he = halfEdgeMesh.getHalfEdge(934, e);
      const twinFace = he.twin >= 0 ? halfEdges[he.twin].faceIndex : -1;
      const f = faces[934];
      const v1 = [f.pA, f.pB, f.pC][e];
      const v2 = [f.pA, f.pB, f.pC][(e + 1) % 3];
      console.log(`  Edge ${e}: twin=${he.twin} twinFace=${twinFace} from=[${v1.toArray().map(n => n.toFixed(3))}] to=[${v2.toArray().map(n => n.toFixed(3))}]`);
    }

    console.log(`\n=== Face 2322 edges ===`);
    if (2322 < faces.length) {
      for (let e = 0; e < 3; e++) {
        const he = halfEdgeMesh.getHalfEdge(2322, e);
        const twinFace = he.twin >= 0 ? halfEdges[he.twin].faceIndex : -1;
        const f = faces[2322];
        const v1 = [f.pA, f.pB, f.pC][e];
        const v2 = [f.pA, f.pB, f.pC][(e + 1) % 3];
        console.log(`  Edge ${e}: twin=${he.twin} twinFace=${twinFace} from=[${v1.toArray().map(n => n.toFixed(3))}] to=[${v2.toArray().map(n => n.toFixed(3))}]`);
      }

      // Check if face 934 and 2322 are physically near each other
      const f934 = faces[934];
      const f2322 = faces[2322];
      const c934 = f934.pA.clone().add(f934.pB).add(f934.pC).multiplyScalar(1/3);
      const c2322 = f2322.pA.clone().add(f2322.pB).add(f2322.pC).multiplyScalar(1/3);
      console.log(`\nFace 934 centroid: [${c934.toArray().map(n => n.toFixed(3))}]`);
      console.log(`Face 2322 centroid: [${c2322.toArray().map(n => n.toFixed(3))}]`);
      console.log(`Distance: ${c934.distanceTo(c2322).toFixed(3)}`);
    }

    // Trace the actual path from face 934 in the -Z direction step by step
    console.log('\n=== Tracing from face 934 outward ===');
    const f = faces[934];
    for (let e = 0; e < 3; e++) {
      const he = halfEdgeMesh.getHalfEdge(934, e);
      const twinFace = he.twin >= 0 ? halfEdges[he.twin].faceIndex : -1;
      console.log(`  Edge ${e} → face ${twinFace}`);
      if (twinFace >= 0) {
        // Check that twin face
        const tf = faces[twinFace];
        const tc = tf.pA.clone().add(tf.pB).add(tf.pC).multiplyScalar(1/3);
        console.log(`    centroid=[${tc.toArray().map(n => n.toFixed(3))}]`);
      }
    }
  });

  it('60-frame reversal diagnostic with detailed direction tracking', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const startPos = surface.getPoint(0.5, 0.0).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();

    console.log('\n=== 60-frame reversal diagnostic ===');
    const data: { frame: number; pos: THREE.Vector3; face: number; projDir: THREE.Vector3; targetUp: THREE.Vector3; disp: THREE.Vector3 }[] = [];

    for (let i = 0; i < 60; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      // Compute projDir
      const z = camera.position.clone().sub(walker.position).normalize();
      const right = targetUp.clone().cross(z).normalize();
      const up = z.clone().cross(right).normalize();
      const moveDir = up.clone().multiplyScalar(-1);
      const projDir = moveDir.clone().addScaledVector(walker.normal, -moveDir.dot(walker.normal)).normalize();

      const prevPos = walker.position.clone();
      const prevFace = walker.faceIndex;
      walker.moveFromInput(0, -1, camera, 1/60, targetUp.clone());
      const disp = walker.position.clone().sub(prevPos);

      data.push({ frame: i, pos: prevPos.clone(), face: prevFace, projDir: projDir.clone(), targetUp: targetUp.clone(), disp: disp.clone() });
    }

    let reversals = 0;
    for (let i = 1; i < data.length; i++) {
      const prevDisp = data[i-1].disp;
      const curDisp = data[i].disp;
      if (prevDisp.length() < 0.0001 || curDisp.length() < 0.0001) continue;
      const dot = prevDisp.clone().normalize().dot(curDisp.clone().normalize());
      if (dot < 0.5) {
        reversals++;
        console.log(`  REVERSAL at frame ${i}: dot=${dot.toFixed(3)}`);
        console.log(`    prev: pos=[${data[i-1].pos.toArray().map(n => n.toFixed(3))}] face=${data[i-1].face} projDir=[${data[i-1].projDir.toArray().map(n => n.toFixed(3))}]`);
        console.log(`    cur:  pos=[${data[i].pos.toArray().map(n => n.toFixed(3))}] face=${data[i].face} projDir=[${data[i].projDir.toArray().map(n => n.toFixed(3))}]`);
        console.log(`    prev disp=[${data[i-1].disp.toArray().map(n => n.toFixed(4))}]`);
        console.log(`    cur  disp=[${data[i].disp.toArray().map(n => n.toFixed(4))}]`);
      }
    }
    console.log(`Total reversals: ${reversals}`);
    console.log('\nFirst 20 frames:');
    data.slice(0, 20).forEach(d => {
      console.log(`  f${d.frame}: face=${d.face} pos=[${d.pos.toArray().map(n => n.toFixed(3))}] projDir=[${d.projDir.toArray().map(n => n.toFixed(3))}] disp=[${d.disp.toArray().map(n => n.toFixed(4))}]`);
    });
  });

  it('trace exact internal bary state at frame 5', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const startPos = surface.getPoint(0.5, 0.0).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();

    console.log('\n=== Internal bary trace ===');
    for (let i = 0; i < 8; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      // Read internal state BEFORE move
      const facePos = (walker as any)._facePos as { faceIndex: number; bary: { u: number; v: number; w: number } };
      const prevFace = facePos.faceIndex;
      const prevBary = { ...facePos.bary };
      const prevPos = walker.position.clone();
      const prevNormal = walker.normal.clone();
      const prevTangent = (walker as any)._tangent.clone() as THREE.Vector3;
      const prevBitangent = (walker as any)._bitangent.clone() as THREE.Vector3;

      walker.moveFromInput(0, -1, camera, 1/60, targetUp.clone());

      const disp = walker.position.clone().sub(prevPos);
      console.log(`f${i}: face=${prevFace} bary=(${prevBary.u.toFixed(4)},${prevBary.v.toFixed(5)},${prevBary.w.toFixed(4)}) normal=[${prevNormal.toArray().map(n => n.toFixed(3))}] tangent=[${prevTangent.toArray().map(n => n.toFixed(3))}] bitangent=[${prevBitangent.toArray().map(n => n.toFixed(3))}]`);
      console.log(`     disp=[${disp.toArray().map(n => n.toFixed(5))}] len=${disp.length().toFixed(5)}`);
    }
  });

  it('inspect face 2322 geometry and baryDir for -Z movement', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const halfEdgeMesh: HalfEdgeMesh = meshSurface.geodesic.halfEdge;
    const halfEdges = halfEdgeMesh.halfEdges;
    const faces = halfEdgeMesh.faces;

    // Print exact face 2322 vertices
    const f2322 = faces[2322];
    console.log(`\n=== Face 2322 exact geometry ===`);
    console.log(`  pA=[${f2322.pA.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  pB=[${f2322.pB.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  pC=[${f2322.pC.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  normal=[${f2322.normal.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  edges:`);
    for (let e = 0; e < 3; e++) {
      const he = halfEdgeMesh.getHalfEdge(2322, e);
      const twinFace = he.twin >= 0 ? halfEdges[he.twin].faceIndex : -1;
      const twinEdgeLocal = he.twin >= 0 ? halfEdges[he.twin].edgeLocal : -1;
      const v1 = [f2322.pA, f2322.pB, f2322.pC][e];
      const v2 = [f2322.pA, f2322.pB, f2322.pC][(e + 1) % 3];
      console.log(`    edge${e}: from=[${v1.toArray().map(n => n.toFixed(4))}] to=[${v2.toArray().map(n => n.toFixed(4))}] twin=${he.twin} twinFace=${twinFace} twinEdgeLocal=${twinEdgeLocal}`);
    }

    // Print face 934 vertices and seam twin info
    const f934 = faces[934];
    console.log(`\n=== Face 934 exact geometry ===`);
    console.log(`  pA=[${f934.pA.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  pB=[${f934.pB.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  pC=[${f934.pC.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  normal=[${f934.normal.toArray().map(n => n.toFixed(6))}]`);
    console.log(`  edges:`);
    for (let e = 0; e < 3; e++) {
      const he = halfEdgeMesh.getHalfEdge(934, e);
      const twinFace = he.twin >= 0 ? halfEdges[he.twin].faceIndex : -1;
      const twinEdgeLocal = he.twin >= 0 ? halfEdges[he.twin].edgeLocal : -1;
      const v1 = [f934.pA, f934.pB, f934.pC][e];
      const v2 = [f934.pA, f934.pB, f934.pC][(e + 1) % 3];
      console.log(`    edge${e}: from=[${v1.toArray().map(n => n.toFixed(4))}] to=[${v2.toArray().map(n => n.toFixed(4))}] twin=${he.twin} twinFace=${twinFace} twinEdgeLocal=${twinEdgeLocal}`);
    }

    // Compute worldDirToBarycentric for face 2322 with transportedDir
    const transportedDir = new THREE.Vector3(-0.0005, 0.0589, -0.9983);
    const pA = f2322.pA, pB = f2322.pB, pC = f2322.pC;
    const e0 = new THREE.Vector3().subVectors(pB, pA);
    const e1 = new THREE.Vector3().subVectors(pC, pA);
    const d00 = e0.dot(e0);
    const d01 = e0.dot(e1);
    const d11 = e1.dot(e1);
    const det = d00 * d11 - d01 * d01;
    const invDet = 1 / det;
    const dirDotE0 = transportedDir.dot(e0);
    const dirDotE1 = transportedDir.dot(e1);
    const dv = (d11 * dirDotE0 - d01 * dirDotE1) * invDet;
    const dw = (d00 * dirDotE1 - d01 * dirDotE0) * invDet;
    const du = -dv - dw;
    console.log(`\n=== worldDirToBarycentric for face 2322, dir=[-0.0005,0.0589,-0.9983] ===`);
    console.log(`  e0=[${e0.toArray().map(n => n.toFixed(4))}]`);
    console.log(`  e1=[${e1.toArray().map(n => n.toFixed(4))}]`);
    console.log(`  d00=${d00.toFixed(6)} d01=${d01.toFixed(6)} d11=${d11.toFixed(6)} det=${det.toFixed(8)}`);
    console.log(`  dirDotE0=${dirDotE0.toFixed(6)} dirDotE1=${dirDotE1.toFixed(6)}`);
    console.log(`  baryDir: du=${du.toFixed(4)} dv=${dv.toFixed(4)} dw=${dw.toFixed(4)}`);
    const worldDisp = new THREE.Vector3().addScaledVector(e0, dv).addScaledVector(e1, dw);
    console.log(`  worldDisp=[${worldDisp.toArray().map(n => n.toFixed(4))}] (should match transportedDir)`);

    // Test _computeEntryBary equivalent for alpha=0.5 (midpoint)
    console.log(`\n=== Entry bary for seam crossing at alpha=0.5 (edge 2, twinEdgeLocal=2) ===`);
    for (const alpha of [0.05, 0.5, 0.95]) {
      const flippedAlpha = 1 - alpha;
      const eps = 0.1;
      const u_raw = flippedAlpha, v_raw = eps, w_raw = 1 - flippedAlpha;
      const sum = u_raw + v_raw + w_raw;
      const u = u_raw/sum, v = v_raw/sum, w = w_raw/sum;
      const worldZ = u*pA.z + v*pB.z + w*pC.z;
      console.log(`  alpha=${alpha}: entry bary=(${u.toFixed(4)},${v.toFixed(4)},${w.toFixed(4)}) worldZ=${worldZ.toFixed(4)}`);
    }
  });
});
