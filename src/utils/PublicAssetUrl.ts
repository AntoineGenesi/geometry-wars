/**
 * Resolve files from Vite's public directory for both root and subfolder deploys.
 *
 * Vite rewrites imported assets and HTML module URLs from `base`, but literal
 * runtime strings like "/assets/flags/en.svg" remain root-relative unless we
 * resolve them ourselves.
 */
export function publicAssetUrl(assetPath: string): string {
  if (isExternalUrl(assetPath)) return assetPath;

  const cleanPath = assetPath.trim().replace(/^\/+/, '').replace(/^\.\//, '');
  const configuredBase = getConfiguredBase();

  if (typeof document !== 'undefined') {
    const moduleBase = getModuleAssetBase();
    if (moduleBase) return new URL(cleanPath, moduleBase).toString();

    if (configuredBase && configuredBase !== './') {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      return new URL(cleanPath, new URL(configuredBase, origin)).toString();
    }

    return new URL(cleanPath, new URL(configuredBase || './', document.baseURI)).toString();
  }

  const base = configuredBase && configuredBase !== './' ? configuredBase : '/';
  return `${base.replace(/\/?$/, '/')}${cleanPath}`;
}

function getConfiguredBase(): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  return meta.env?.BASE_URL ?? '/';
}

function getModuleAssetBase(): string | null {
  const marker = '/assets/';
  const markerIndex = import.meta.url.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  return import.meta.url.slice(0, markerIndex + 1);
}

function isExternalUrl(url: string): boolean {
  return /^(?:[a-z][a-z\d+\-.]*:)?\/\//i.test(url)
    || url.startsWith('blob:')
    || url.startsWith('data:');
}
