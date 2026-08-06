export const MESH_UPLOAD_ALLOWED_EXTENSIONS = ['obj', 'glb', 'gltf'] as const;

export type MeshUploadExtension = typeof MESH_UPLOAD_ALLOWED_EXTENSIONS[number];

const MB = 1024 * 1024;

export const MESH_UPLOAD_MAX_BYTES: Record<MeshUploadExtension, number> = {
  obj: 8 * MB,
  glb: 16 * MB,
  gltf: 8 * MB,
};

export interface MeshUploadValidationResult {
  ok: boolean;
  extension?: MeshUploadExtension;
  maxBytes?: number;
  error?: string;
}

export function getMeshUploadExtension(filename: string): MeshUploadExtension | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  if (!match) return null;
  const extension = match[1].toLowerCase();
  return MESH_UPLOAD_ALLOWED_EXTENSIONS.includes(extension as MeshUploadExtension)
    ? extension as MeshUploadExtension
    : null;
}

export function formatMeshUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
}

export function describeMeshUploadLimits(): string {
  return 'Supported: .obj up to 8 MB, .glb/.gltf up to 16 MB. Single object only; LAN/custom portals are not supported yet.';
}

export function validateMeshUploadFile(file: Pick<File, 'name' | 'size'> | null | undefined): MeshUploadValidationResult {
  if (!file) {
    return { ok: false, error: 'Choose a mesh file before starting a custom map.' };
  }

  const extension = getMeshUploadExtension(file.name);
  if (!extension) {
    return {
      ok: false,
      error: `Unsupported file type for "${file.name}". Use .obj, .glb, or .gltf.`,
    };
  }

  const maxBytes = MESH_UPLOAD_MAX_BYTES[extension];
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      ok: false,
      extension,
      maxBytes,
      error: `Mesh file "${file.name}" is empty or unreadable.`,
    };
  }

  if (file.size > maxBytes) {
    return {
      ok: false,
      extension,
      maxBytes,
      error: `Mesh file "${file.name}" is ${formatMeshUploadBytes(file.size)}; ${extension.toUpperCase()} uploads are limited to ${formatMeshUploadBytes(maxBytes)}.`,
    };
  }

  return { ok: true, extension, maxBytes };
}
