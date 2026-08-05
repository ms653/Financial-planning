import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  escapeForDotenvExpand,
  hashPassphrase,
  looksLikeArgon2idHash,
  verifyPassphrase,
} from './passphrase';

describe('hashPassphrase', () => {
  it('produces an argon2id PHC string, not a bare digest', async () => {
    const hash = await hashPassphrase('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(looksLikeArgon2idHash(hash)).toBe(true);
  });

  it('embeds the configured cost parameters so verification stays reproducible', async () => {
    const hash = await hashPassphrase('correct horse battery staple');
    expect(hash).toContain(`m=${ARGON2_OPTIONS.memoryCost}`);
    expect(hash).toContain(`t=${ARGON2_OPTIONS.timeCost}`);
    expect(hash).toContain(`p=${ARGON2_OPTIONS.parallelism}`);
  });

  it('uses argon2id specifically, not argon2i or argon2d', () => {
    // Guards against someone "simplifying" ARGON2_OPTIONS and silently dropping to a
    // variant with worse GPU or side-channel resistance.
    expect(ARGON2_OPTIONS.algorithm).toBe(2);
  });

  it('meets the OWASP argon2id memory floor', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19456);
    expect(ARGON2_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
  });

  it('salts each hash, so the same passphrase never yields the same hash twice', async () => {
    const a = await hashPassphrase('correct horse battery staple');
    const b = await hashPassphrase('correct horse battery staple');
    expect(a).not.toBe(b);
    // ...and both still verify.
    await expect(verifyPassphrase('correct horse battery staple', a)).resolves.toEqual({ ok: true });
    await expect(verifyPassphrase('correct horse battery staple', b)).resolves.toEqual({ ok: true });
  });

  it('refuses to hash an empty passphrase', async () => {
    await expect(hashPassphrase('')).rejects.toThrow(/empty passphrase/i);
  });
});

describe('escapeForDotenvExpand', () => {
  const originalHashEnv = process.env.APP_PASSPHRASE_HASH;

  afterEach(() => {
    if (originalHashEnv === undefined) {
      delete process.env.APP_PASSPHRASE_HASH;
    } else {
      process.env.APP_PASSPHRASE_HASH = originalHashEnv;
    }
  });

  it('round-trips an argon2id hash through the real @next/env loader unmangled', async () => {
    // Reproduces the actual bug, not just the regex: `next dev` reads .env files
    // through @next/env's bundled dotenv-expand, which treats a bare `$word` as a
    // variable reference. An unescaped hash comes back with every `$argon2id`,
    // `$v=19`, `$m=...` segment silently stripped. This drives the real loader
    // (not a hand-rolled stand-in for it) to confirm the escaped form survives.
    const hash =
      '$argon2id$v=19$m=19456,t=2,p=1$1WpS3idYwgu2+MxUJTfZsA$1OtmRvANhrvfZhtjOciau4KxrCR9/ID7rCHDMun4J+4';
    const escaped = escapeForDotenvExpand(hash);
    expect(escaped).not.toBe(hash); // sanity: the fixture actually exercises escaping

    const dir = await mkdtemp(join(tmpdir(), 'dotenv-expand-test-'));
    try {
      await writeFile(join(dir, '.env'), `APP_PASSPHRASE_HASH='${escaped}'\n`);
      const { loadEnvConfig } = await import('@next/env');
      const silentLogger = { info() {}, error() {}, warn() {} };
      const { combinedEnv } = loadEnvConfig(dir, false, silentLogger, true);
      expect(combinedEnv.APP_PASSPHRASE_HASH).toBe(hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves a value with no `$` unchanged', () => {
    expect(escapeForDotenvExpand('no-dollar-signs-here')).toBe('no-dollar-signs-here');
  });
});

describe('looksLikeArgon2idHash', () => {
  it('accepts a well-formed argon2id hash', () => {
    expect(
      looksLikeArgon2idHash(
        '$argon2id$v=19$m=19456,t=2,p=1$1WpS3idYwgu2+MxUJTfZsA$1OtmRvANhrvfZhtjOciau4KxrCR9/ID7rCHDMun4J+4',
      ),
    ).toBe(true);
  });

  it('rejects a plaintext passphrase — the deploy mistake this exists to catch', () => {
    expect(looksLikeArgon2idHash('correct horse battery staple')).toBe(false);
  });

  it('rejects other argon2 variants and bcrypt', () => {
    expect(looksLikeArgon2idHash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0')).toBe(false);
    expect(looksLikeArgon2idHash('$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTU')).toBe(
      false,
    );
  });

  it('rejects a truncated hash with the right prefix', () => {
    expect(looksLikeArgon2idHash('$argon2id$v=19$m=19456,t=2,p=1')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(looksLikeArgon2idHash('')).toBe(false);
  });
});

describe('verifyPassphrase', () => {
  it('accepts the correct passphrase', async () => {
    const hash = await hashPassphrase('a very long household passphrase');
    await expect(verifyPassphrase('a very long household passphrase', hash)).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects a wrong passphrase', async () => {
    const hash = await hashPassphrase('a very long household passphrase');
    await expect(verifyPassphrase('a very long household passphras', hash)).resolves.toEqual({
      ok: false,
      reason: 'wrong-passphrase',
    });
  });

  it('is case-sensitive and whitespace-sensitive', async () => {
    const hash = await hashPassphrase('Household Passphrase');
    await expect(verifyPassphrase('household passphrase', hash)).resolves.toEqual({
      ok: false,
      reason: 'wrong-passphrase',
    });
    await expect(verifyPassphrase(' Household Passphrase', hash)).resolves.toEqual({
      ok: false,
      reason: 'wrong-passphrase',
    });
  });

  it('rejects an empty submission without touching the hash', async () => {
    const hash = await hashPassphrase('a very long household passphrase');
    await expect(verifyPassphrase('', hash)).resolves.toEqual({
      ok: false,
      reason: 'empty-input',
    });
  });

  it('reports misconfiguration rather than "wrong passphrase" when the stored value is plaintext', async () => {
    // The critical case: if APP_PASSPHRASE_HASH holds the plaintext passphrase, a
    // naive implementation would compare it directly and let anyone in. This must
    // fail, and must fail loudly enough to be diagnosable.
    await expect(
      verifyPassphrase('correct horse battery staple', 'correct horse battery staple'),
    ).resolves.toEqual({ ok: false, reason: 'misconfigured-hash' });
  });

  it('rejects a bare unsalted digest of the passphrase', async () => {
    // sha256('hunter2') — the "bare-hash comparison" the spec forbids.
    const bareSha256 = 'f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7';
    await expect(verifyPassphrase('hunter2', bareSha256)).resolves.toEqual({
      ok: false,
      reason: 'misconfigured-hash',
    });
  });

  it('does not throw on a malformed hash that has the right prefix', async () => {
    await expect(
      verifyPassphrase('anything', '$argon2id$v=19$m=bogus,t=x,p=y$!!!!$!!!!'),
    ).resolves.toEqual({ ok: false, reason: 'misconfigured-hash' });
  });

  it('verifies a hash made with different cost parameters than the current config', async () => {
    // argon2 PHC strings carry their own parameters, so raising ARGON2_OPTIONS later
    // must not lock the household out of a hash generated under the old settings.
    const { hash } = await import('@node-rs/argon2');
    const legacy = await hash('a very long household passphrase', {
      algorithm: 2,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });
    await expect(verifyPassphrase('a very long household passphrase', legacy)).resolves.toEqual({
      ok: true,
    });
  });
});
