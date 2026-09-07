import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './utils';

describe('safeRedirectPath', () => {
  it('accepts a same-origin path', () => {
    expect(safeRedirectPath('/inventory')).toBe('/inventory');
    expect(safeRedirectPath('/admin/inventory/locations')).toBe('/admin/inventory/locations');
  });

  it('keeps the query string, which carries the filters', () => {
    expect(safeRedirectPath('/inventory?week=37&status=to_review')).toBe(
      '/inventory?week=37&status=to_review',
    );
  });

  it('rejects an absolute URL', () => {
    expect(safeRedirectPath('https://evil.example/steal')).toBeNull();
    expect(safeRedirectPath('http://evil.example')).toBeNull();
  });

  // The interesting case: these start with "/" but the browser resolves them
  // against another origin, so a naive startsWith('/') check lets them through.
  it('rejects protocol-relative paths', () => {
    expect(safeRedirectPath('//evil.example/steal')).toBeNull();
    expect(safeRedirectPath('/\\evil.example/steal')).toBeNull();
  });

  it('rejects the auth screens, which would loop', () => {
    expect(safeRedirectPath('/login')).toBeNull();
    expect(safeRedirectPath('/register')).toBeNull();
    expect(safeRedirectPath('/login/')).toBeNull();
  });

  it('rejects nothing at all', () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
  });

  it('does not reject a path that merely starts with the same letters', () => {
    expect(safeRedirectPath('/registered-items')).toBe('/registered-items');
  });
});
