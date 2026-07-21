import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const uploadsRoot = fileURLToPath(new URL('../../uploads/', import.meta.url));

export function uploadUrlToFilePath(urlPath: string): string | null {
  const prefix = '/uploads/';
  if (!urlPath.startsWith(prefix)) return null;

  const absolutePath = resolve(uploadsRoot, urlPath.slice(prefix.length));
  const rootWithSeparator = uploadsRoot.endsWith(sep) ? uploadsRoot : `${uploadsRoot}${sep}`;
  return absolutePath.startsWith(rootWithSeparator) ? absolutePath : null;
}
