import { describe, expect, it } from 'vitest';
import {
  describeMeshUploadLimits,
  getMeshUploadExtension,
  MESH_UPLOAD_MAX_BYTES,
  validateMeshUploadFile,
} from './MeshUploadValidation';

function fileLike(name: string, size: number): Pick<File, 'name' | 'size'> {
  return { name, size };
}

describe('MeshUploadValidation', () => {
  it('allows supported mesh extensions case-insensitively', () => {
    expect(getMeshUploadExtension('arena.OBJ')).toBe('obj');
    expect(getMeshUploadExtension('arena.glb')).toBe('glb');
    expect(getMeshUploadExtension('arena.gltf')).toBe('gltf');
  });

  it('rejects unsupported file types', () => {
    const result = validateMeshUploadFile(fileLike('arena.zip', 1024));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unsupported file type');
  });

  it('rejects missing or empty files before parsing', () => {
    expect(validateMeshUploadFile(null).error).toContain('Choose a mesh file');
    expect(validateMeshUploadFile(fileLike('empty.obj', 0)).error).toContain('empty or unreadable');
  });

  it('applies per-format upload size limits', () => {
    const result = validateMeshUploadFile(fileLike('heavy.obj', MESH_UPLOAD_MAX_BYTES.obj + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('OBJ uploads are limited');
  });

  it('returns ok metadata for a valid uploaded mesh', () => {
    const result = validateMeshUploadFile(fileLike('player-map.obj', 4096));
    expect(result).toMatchObject({ ok: true, extension: 'obj', maxBytes: MESH_UPLOAD_MAX_BYTES.obj });
  });

  it('describes the visible first-release contract', () => {
    expect(describeMeshUploadLimits()).toContain('.obj/.gltf up to 8 MB');
    expect(describeMeshUploadLimits()).toContain('.glb up to 16 MB');
    expect(describeMeshUploadLimits()).toContain('Single object only');
    expect(describeMeshUploadLimits()).toContain('multiplayer, LAN, and custom portals are not supported');
  });
});
