import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Passphrase hashing and verification.
 *
 * Per PROPOSAL.md's Security notes: argon2id, constant-time verify, never a
 * plaintext or bare-hash comparison. The stored artefact is an argon2id PHC string
 * held in the APP_PASSPHRASE_HASH environment variable — the plaintext passphrase
 * exists only in the household's heads and in whatever they type into /login.
 *
 * On the documented bcrypt fallback: the proposal allows bcrypt at cost >= 12 if
 * argon2's native dependency complicates the Docker build. It does not —
 * @node-rs/argon2 ships prebuilt NAPI binaries for linux-x64-gnu and needs no
 * compiler in the image — so the fallback is deliberately NOT implemented. A
 * second, rarely-exercised verification branch in the one security-critical
 * comparison in the app is a worse trade than a documented single path. If a future
 * platform genuinely can't run argon2, add bcrypt here as an explicit alternative
 * keyed off the hash prefix, and update this comment.
 */

/**
 * OWASP's second recommended argon2id configuration (m=19 MiB, t=2, p=1). Comfortably
 * above the library defaults (m=4 MiB, t=3) on memory, which is the parameter that
 * actually costs an attacker with GPUs.
 *
 * Changing these does not invalidate existing hashes — argon2 PHC strings carry their
 * own parameters, and verify() reads them from the stored hash rather than from here.
 * These values apply to newly generated hashes only.
 */
/**
 * `Algorithm.Argon2id` is an ambient const enum, which `isolatedModules` forbids
 * reading at runtime, so the value is written literally and type-asserted. 2 is
 * Argon2id — asserted rather than left as a bare number so a wrong value is a type
 * error rather than a silently weaker hash.
 */
const ARGON2ID = 2 as Algorithm;

export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const ARGON2ID_PREFIX = '$argon2id$';

/**
 * Escape every `$` as `\$` — the one shape `@next/env`'s bundled dotenv-expand leaves
 * alone (it skips a `$` preceded by `\`, then un-escapes it back to a literal `$`).
 * An argon2id PHC string is otherwise full of the exact pattern dotenv-expand treats
 * as a variable reference ($argon2id$v=19$...), which `next dev` silently mangles
 * when reading it from `.env`/`.env.local` — `scripts/hash-passphrase.ts` uses this to
 * print a version safe for that specific case. Quoting the value does NOT help here;
 * dotenv-expand strips quotes before scanning for `$`, same as the unescaped case.
 * Not needed for `docker compose`, which passes `.env` values straight through — and
 * escaping there would be actively wrong, handing the container literal backslashes.
 */
export function escapeForDotenvExpand(value: string): string {
  return value.replace(/\$/g, '\\$');
}

/** Produce an argon2id PHC-format hash of a passphrase. Used by scripts/hash-passphrase.ts. */
export async function hashPassphrase(passphrase: string): Promise<string> {
  if (passphrase.length === 0) {
    throw new Error('Refusing to hash an empty passphrase.');
  }
  return hash(passphrase, ARGON2_OPTIONS);
}

/**
 * True if `value` looks like an argon2id PHC string.
 *
 * This exists to catch a specific, plausible and quiet deploy mistake: putting the
 * plaintext passphrase into APP_PASSPHRASE_HASH. argon2's verify() would simply
 * return false for every input, producing an app nobody can log into with no clue
 * why — so we fail loudly at the misconfiguration instead.
 */
export function looksLikeArgon2idHash(value: string): boolean {
  if (!value.startsWith(ARGON2ID_PREFIX)) return false;
  // $argon2id$v=19$m=...,t=...,p=...$<salt>$<digest> => 6 segments once split on '$'
  // ('' , 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, digest)
  return value.split('$').length === 6;
}

export type PassphraseVerification =
  | { ok: true }
  | { ok: false; reason: 'wrong-passphrase' | 'empty-input' | 'misconfigured-hash' };

/**
 * Verify a submitted passphrase against a stored argon2id hash.
 *
 * argon2's verify() is constant-time with respect to the digest comparison, so no
 * manual timing defence is needed here. Timing does still vary with the *parameters*
 * embedded in the stored hash, but that hash is fixed for a deployment, so it leaks
 * nothing about the submitted value.
 *
 * Never throws for a bad passphrase — callers get a discriminated result so the
 * login action can decide what to tell the user (which is always the same generic
 * message; the distinction here is for logs and for failing loudly on
 * misconfiguration).
 */
export async function verifyPassphrase(
  submitted: string,
  storedHash: string,
): Promise<PassphraseVerification> {
  if (submitted.length === 0) {
    return { ok: false, reason: 'empty-input' };
  }
  if (!looksLikeArgon2idHash(storedHash)) {
    return { ok: false, reason: 'misconfigured-hash' };
  }
  try {
    const matches = await verify(storedHash, submitted);
    return matches ? { ok: true } : { ok: false, reason: 'wrong-passphrase' };
  } catch {
    // A malformed-but-prefix-matching hash lands here rather than crashing the action.
    return { ok: false, reason: 'misconfigured-hash' };
  }
}
