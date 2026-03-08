import { describe, it } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from '../../src/surfaces/geodesic/HalfEdgeMesh';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { MeshWalker } from '../../src/movement/MeshWalker';

const R = 8, W = 3, SEG_U = 64, SEG_V = 16;

function buildMobiusMesh(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i < SEG_U; i++) {
    const t = (i / SEG_U) * Math.PI * 2;
    const halfT = t / 2;
    for (let j = 0; j <= SEG_V; j++) {
      const s = (j / SEG_V - 0.5) * 2 * W;
      vertices.push((R + s * Math.cos(halfT)) * Math.cos(t), (R + s * Math.cos(halfT)) * Math.sin(t), s * Math.sin(halfT));
      const dtX = -s*0.5*Math.sin(halfT)*Math.cos(t) - (R+s*Math.cos(halfT))*Math.sin(t);
      const dtY = -s*0.5*Math.sin(halfT)*Math.sin(t) + (R+s*Math.cos(halfT))*Math.cos(t);
      const dtZ = s*0.5*Math.cos(halfT);
      const dsX = Math.cos(halfT)*Math.cos(t), dsY = Math.cos(halfT)*Math.sin(t), dsZ = Math.sin(halfT);
      const n = new THREE.Vector3().crossVectors(new THREE.Vector3(dtX,dtY,dtZ), new THREE.Vector3(dsX,dsY,dsZ)).normalize();
      normals.push(n.x, n.y, n.z); uvs.push(i/SEG_U, j/SEG_V);
    }
  }
  for (let i = 0; i < SEG_U - 1; i++) for (let j = 0; j < SEG_V; j++) {
    const a = i*(SEG_V+1)+j, b=a+SEG_V+1, c=a+1, d=b+1;
    indices.push(a,b,c); indices.push(b,d,c);
  }
  const lastBodyRow = (SEG_U-1)*(SEG_V+1);
  for (let j = 0; j < SEG_V; j++) {
    indices.push(lastBodyRow+j, SEG_V-j, lastBodyRow+j+1);
    indices.push(SEG_V-j, SEG_V-j-1, lastBodyRow+j+1);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

if (typeof globalThis.window === 'undefined') (globalThis as any).window = { addEventListener: ()=>{}, removeEventListener: ()=>{} };
if (typeof globalThis.document === 'undefined') {
  const _noop = ()=>{};
  (globalThis as any).document = { createElement: (tag: string) => tag==='canvas'?{width:64,height:64,style:{},getContext:()=>null,addEventListener:_noop,removeEventListener:_noop}:{style:{},appendChild:_noop}, body:{appendChild:_noop,style:{}}, hidden:false, addEventListener:_noop, removeEventListener:_noop };
}

describe('Mobius diagnostic', () => {
  it('traces CHECK2 step by step', () => {
    const geometry = buildMobiusMesh();
    const halfEdge = new HalfEdgeMesh(geometry);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld();
    const surface = new MeshSurface(mesh);

    const rowIdx = Math.floor(SEG_U * 0.75);
    const colIdx = Math.floor(SEG_V / 2);
    const faceIdx = rowIdx * SEG_V * 2 + colIdx * 2;
    const bary = { u: 1/3, v: 1/3, w: 1/3 };
    const [pA,pB,pC] = halfEdge.getFaceVertices(faceIdx);
    const startPos = new THREE.Vector3().addScaledVector(pA,bary.u).addScaledVector(pB,bary.v).addScaledVector(pC,bary.w);
    const walker = new MeshWalker(surface, startPos, 5.0);
    const faceNormal = halfEdge.faces[faceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0,0,1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();
    
    const circumference = 2 * Math.PI * R;
    const walkDist = circumference * 0.4;
    const stepDist = walker.speed;
    let currentDir = tangent.clone();
    let totalDist = 0;
    let steps = 0;
    const maxSteps = 20;

    console.log(`Start angle: ${(Math.atan2(startPos.y,startPos.x)*180/Math.PI).toFixed(1)}°`);
    while (totalDist < walkDist && steps < maxSteps) {
      const result = walker.move(currentDir, 1.0);
      if (result) {
        const pos = walker.position;
        const angle = Math.atan2(pos.y, pos.x) * 180 / Math.PI;
        const t = walker.tangent;
        console.log(`Step ${steps+1}: angle=${angle.toFixed(1)}° tangent=(${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}) dist=${result.distance?.toFixed(3)}`);
        currentDir = walker.tangent.clone();
        totalDist += result.distance || stepDist;
      }
      steps++;
    }
    const endAngle = Math.atan2(walker.position.y, walker.position.x);
    console.log(`End angle: ${(endAngle*180/Math.PI).toFixed(1)}° (< π = ${endAngle < Math.PI})`);
  });
});
