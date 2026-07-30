import * as THREE from 'three';
import {
  createEnemyPreviewObject,
  disposePreviewObject,
  isPreviewEnemyType,
} from '../entities/enemies/EnemyPreviewFactory';

const PREVIEW_SIZE = 72;
const thumbnailCache = new Map<string, string>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function ensurePreviewRenderer(): boolean {
  if (renderer && scene && camera) return true;
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 2.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.2, 2.6, 3);
    const rim = new THREE.DirectionalLight(0x44ffff, 1.2);
    rim.position.set(-2.4, -1.8, 2);
    scene.add(ambient, key, rim);
    return true;
  } catch {
    renderer = null;
    scene = null;
    camera = null;
    return false;
  }
}

export function renderEnemyPreviewDataUrl(enemyType: string): string | null {
  const normalizedType = isPreviewEnemyType(enemyType) ? enemyType : null;
  if (!normalizedType) return null;

  const cached = thumbnailCache.get(normalizedType);
  if (cached) return cached;
  if (!ensurePreviewRenderer() || !renderer || !scene || !camera) return null;

  const object = createEnemyPreviewObject(normalizedType);
  if (!object) return null;

  scene.add(object);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  scene.remove(object);
  disposePreviewObject(object);

  thumbnailCache.set(normalizedType, dataUrl);
  return dataUrl;
}

export function createEnemyModelPreviewElement(
  enemyType: string,
  label: string,
  fallbackColor: string,
): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'ap-enemy-preview';
  preview.dataset.enemyPreview = enemyType;
  preview.title = `${label} model preview`;

  const dataUrl = renderEnemyPreviewDataUrl(enemyType);
  if (dataUrl) {
    const img = document.createElement('img');
    img.className = 'ap-enemy-preview-img';
    img.alt = `${label} model`;
    img.src = dataUrl;
    preview.appendChild(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'ap-enemy-preview-fallback';
    fallback.style.borderColor = fallbackColor;
    fallback.style.boxShadow = `0 0 12px ${fallbackColor}`;
    fallback.style.background = `radial-gradient(circle, ${fallbackColor} 0%, rgba(0,0,0,0) 68%)`;
    preview.appendChild(fallback);
  }

  return preview;
}

export function clearEnemyPreviewCacheForTests(): void {
  thumbnailCache.clear();
}
