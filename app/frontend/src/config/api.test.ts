import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL, resolveBackendAssetUrl } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveBackendAssetUrl', () => {
  it.each([
    'https://cdn.example.com/assets/report.pdf',
    'http://cdn.example.com/assets/report.pdf',
    'data:image/png;base64,aGVsbG8=',
    'blob:https://frontend.example/asset-id',
  ])('leaves an already usable URL unchanged: %s', (url: string) => {
    expect(resolveBackendAssetUrl(url)).toBe(url);
  });

  it('recognizes supported URL schemes case-insensitively', () => {
    const url = 'HTTPS://cdn.example.com/assets/report.pdf';

    expect(resolveBackendAssetUrl(url)).toBe(url);
  });

  it('resolves a root-relative path against the backend origin', () => {
    vi.stubGlobal('window', { location: { origin: 'https://frontend.example' } });
    const backendOrigin = new URL(API_BASE_URL, window.location.origin).origin;

    expect(resolveBackendAssetUrl('/uploads/report.pdf')).toBe(
      `${backendOrigin}/uploads/report.pdf`,
    );
  });

  it('resolves a relative path from the backend origin root', () => {
    vi.stubGlobal('window', { location: { origin: 'https://frontend.example' } });
    const backendOrigin = new URL(API_BASE_URL, window.location.origin).origin;

    expect(resolveBackendAssetUrl('uploads/한글 보고서.pdf')).toBe(
      `${backendOrigin}/uploads/%ED%95%9C%EA%B8%80%20%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf`,
    );
  });
});
