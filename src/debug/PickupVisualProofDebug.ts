import * as THREE from 'three';

export interface PickupVisualProofRecord {
  id: string;
  type: string;
  mesh: THREE.Group;
}

export interface PickupVisualProofOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  getPickups: () => PickupVisualProofRecord[];
}

export interface PickupVisualProofSample {
  id: string;
  type: string;
  matrixFinite: boolean;
  determinant: number;
  matrixScale: [number, number, number];
  worldPosition: [number, number, number];
  quaternion: [number, number, number, number];
  projected: { x: number; y: number; z: number; inView: boolean };
  body: {
    meshCount: number;
    lineCount: number;
    spriteCount: number;
    hasCore: boolean;
    hasIcon: boolean;
    size: [number, number, number];
  };
  indicatorVisible: boolean;
  visibilityClass: string | null;
  bodyVisibility: number | null;
}

export function createPickupVisualProofDebug(options: PickupVisualProofOptions) {
  const originalRootVisibility = new Map<THREE.Object3D, boolean>();
  const originalIndicatorVisibility = new Map<THREE.Object3D, boolean>();
  const originalIsolationFlags = new Map<THREE.Group, boolean>();
  let isolated = false;

  const restoreIsolation = (): void => {
    for (const [object, visible] of originalRootVisibility) object.visible = visible;
    for (const [object, visible] of originalIndicatorVisibility) object.visible = visible;
    for (const [mesh, value] of originalIsolationFlags) mesh.userData.pickupBodyProofIsolated = value;
    originalRootVisibility.clear();
    originalIndicatorVisibility.clear();
    originalIsolationFlags.clear();
    isolated = false;
  };

  const setPickupVisualProofIsolation = (pickupId: string | null): Record<string, unknown> => {
    if (!pickupId) {
      restoreIsolation();
      return { isolated: false };
    }

    if (isolated) restoreIsolation();
    const records = options.getPickups();
    const selected = records.find((record) => record.id === pickupId);
    const backgroundOnly = pickupId === '__background__';
    if (!selected && !backgroundOnly) return { isolated: false, error: `unknown pickup ${pickupId}` };

    const pickupRoots = new Set(records.map((record) => record.mesh));
    for (const root of options.scene.children) {
      originalRootVisibility.set(root, root.visible);
      root.visible = root instanceof THREE.Light
        || (!backgroundOnly && pickupRoots.has(root) && root === selected!.mesh);
    }

    for (const record of records) {
      originalIsolationFlags.set(record.mesh, record.mesh.userData.pickupBodyProofIsolated === true);
      record.mesh.userData.pickupBodyProofIsolated = true;
      const indicator = record.mesh.getObjectByName('spawn-indicator');
      if (!indicator) continue;
      originalIndicatorVisibility.set(indicator, indicator.visible);
      indicator.visible = false;
    }
    if (selected) selected.mesh.visible = true;
    isolated = true;
    return { isolated: true, pickupId, backgroundOnly, spawnIndicatorVisible: false };
  };

  const getPickupVisualProofSamples = (): PickupVisualProofSample[] => {
    options.camera.updateMatrixWorld(true);
    return options.getPickups().map((record) => {
      record.mesh.updateMatrixWorld(true);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      record.mesh.matrixWorld.decompose(position, quaternion, scale);
      const projected = position.clone().project(options.camera);
      const bodyBox = new THREE.Box3();
      let meshCount = 0;
      let lineCount = 0;
      let spriteCount = 0;
      let hasCore = false;
      let hasIcon = false;
      record.mesh.traverse((child) => {
        if (child.name === 'spawn-indicator') return;
        if (child.name === 'core') hasCore = true;
        if (child.name === 'pickup-icon') hasIcon = true;
        if (child instanceof THREE.Mesh) {
          meshCount++;
          bodyBox.expandByObject(child);
        } else if (child instanceof THREE.Line) {
          lineCount++;
          bodyBox.expandByObject(child);
        } else if (child instanceof THREE.Sprite) {
          spriteCount++;
        }
      });
      const bodySize = bodyBox.isEmpty() ? new THREE.Vector3() : bodyBox.getSize(new THREE.Vector3());
      const surfaceVisibility = record.mesh.userData.surfaceVisibility as { className?: string } | undefined;
      const bodyVisibility = record.mesh.userData.pickupBodyVisibility;
      const indicator = record.mesh.getObjectByName('spawn-indicator');

      return {
        id: record.id,
        type: record.type,
        matrixFinite: record.mesh.matrixWorld.elements.every(Number.isFinite),
        determinant: record.mesh.matrixWorld.determinant(),
        matrixScale: scale.toArray(),
        worldPosition: position.toArray(),
        quaternion: quaternion.toArray(),
        projected: {
          x: projected.x,
          y: projected.y,
          z: projected.z,
          inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1,
        },
        body: {
          meshCount,
          lineCount,
          spriteCount,
          hasCore,
          hasIcon,
          size: bodySize.toArray(),
        },
        indicatorVisible: indicator?.visible === true,
        visibilityClass: surfaceVisibility?.className ?? null,
        bodyVisibility: typeof bodyVisibility === 'number' ? bodyVisibility : null,
      };
    });
  };

  return {
    getPickupVisualProofSamples,
    setPickupVisualProofIsolation,
  };
}
