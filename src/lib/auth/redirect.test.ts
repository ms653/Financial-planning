import { describe, expect, it } from 'vitest';
import { safeRedirectTarget } from './redirect';

const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe('safeRedirectTarget', () => {
  it('passes through a plain relative path', () => {
    expect(safeRedirectTarget('/accounts')).toBe('/accounts');
  });

  it('preserves a query string', () => {
    expect(safeRedirectTarget('/accounts?filter=isa')).toBe('/accounts?filter=isa');
  });

  it('defaults to / for empty, null, and undefined', () => {
    expect(safeRedirectTarget('')).toBe('/');
    expect(safeRedirectTarget(null)).toBe('/');
    expect(safeRedirectTarget(undefined)).toBe('/');
  });

  it.each([
    ['absolute http URL', 'http://evil.example/steal'],
    ['absolute https URL', 'https://evil.example/steal'],
    ['protocol-relative URL', '//evil.example/steal'],
    ['backslash-smuggled protocol-relative', '/\\evil.example'],
    ['double backslash', '\\\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['bare path without leading slash', 'accounts'],
    ['newline injection', '/accounts\nLocation: https://evil.example'],
    ['carriage return injection', '/accounts\r\nSet-Cookie: x=y'],
    ['tab', '/accounts\there'],
    ['leading space', ' /accounts'],
    ['null byte', `/accounts${NUL}`],
    ['DEL character', `/accounts${DEL}`],
  ])('rejects %s', (_label, candidate) => {
    expect(safeRedirectTarget(candidate)).toBe('/');
  });

  it('allows a nested path', () => {
    expect(safeRedirectTarget('/retirement/42/edit')).toBe('/retirement/42/edit');
  });

  it('allows an encoded path without decoding it', () => {
    // Not decoded here: decoding would reintroduce the very characters just rejected.
    expect(safeRedirectTarget('/accounts%2Ffoo')).toBe('/accounts%2Ffoo');
  });
});
