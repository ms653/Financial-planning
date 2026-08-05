/**
 * Generate the APP_PASSPHRASE_HASH value for a chosen household passphrase.
 *
 *   npm run passphrase:hash
 *
 * Reads the passphrase from stdin rather than from argv so it never lands in shell
 * history or in the process list, and echoes nothing but the resulting hash. The
 * plaintext passphrase is never written to disk by this script.
 *
 * Prints two variants, not one: an argon2id PHC string is full of literal `$`
 * characters ($argon2id$v=19$...), and `docker compose` vs. `next dev` disagree about
 * what to do with those. Compose passes a `.env` value straight through to the
 * container untouched, so the raw hash is correct there. `next dev` reading a
 * `.env`/`.env.local` file runs every value through `@next/env`'s bundled
 * dotenv-expand first, which silently mangles that shape — see
 * `escapeForDotenvExpand`'s own doc comment (`src/lib/auth/passphrase.ts`) for why
 * only backslash-escaping fixes it, and why the Compose-bound copy must NOT be
 * escaped the same way. Two copies, each correct for its own destination, so nobody
 * has to hand-edit either at 11pm and get the direction backwards.
 */
import { createInterface } from 'node:readline';
import {
  escapeForDotenvExpand,
  hashPassphrase,
  looksLikeArgon2idHash,
} from '../src/lib/auth/passphrase';

const MIN_LENGTH = 12;

async function readPassphrase(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });

  // Suppress echo so the passphrase isn't left visible on screen or in a screenshot.
  const output = rl as unknown as { output?: { write: (chunk: string) => void } };
  const originalWrite = output.output?.write?.bind(output.output);
  let muted = false;
  if (output.output && originalWrite) {
    output.output.write = (chunk: string) => {
      if (!muted) originalWrite(chunk);
    };
  }

  process.stderr.write(prompt);
  muted = true;
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  muted = false;
  if (output.output && originalWrite) output.output.write = originalWrite;
  process.stderr.write('\n');
  rl.close();
  return answer;
}

async function main(): Promise<void> {
  const passphrase = await readPassphrase('Household passphrase: ');
  if (passphrase.length < MIN_LENGTH) {
    process.stderr.write(
      `Passphrase must be at least ${MIN_LENGTH} characters. A memorable multi-word phrase beats a short complex one.\n`,
    );
    process.exit(1);
  }

  const confirmation = await readPassphrase('Confirm passphrase: ');
  if (confirmation !== passphrase) {
    process.stderr.write('Passphrases did not match. Nothing written.\n');
    process.exit(1);
  }

  const hash = await hashPassphrase(passphrase);
  if (!looksLikeArgon2idHash(hash)) {
    process.stderr.write('Generated hash failed its own format check — refusing to print it.\n');
    process.exit(1);
  }

  // Both variants go to stdout so either line can be piped or redirected on its own;
  // all prose goes to stderr.
  process.stderr.write('\nFor .env (docker compose) — paste as-is:\n\n');
  process.stdout.write(`APP_PASSPHRASE_HASH='${hash}'\n`);
  process.stderr.write(
    '\nFor .env.local (running `npm run dev` directly, no Docker) — every `$` escaped\n' +
      'so `next dev`\'s own env loader stops treating the hash as variable references:\n\n',
  );
  process.stdout.write(`APP_PASSPHRASE_HASH='${escapeForDotenvExpand(hash)}'\n`);
  process.stderr.write('\nUse whichever line matches how you run the app. Never commit either.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
