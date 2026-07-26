/**
 * Generate the APP_PASSPHRASE_HASH value for a chosen household passphrase.
 *
 *   npm run passphrase:hash
 *
 * Reads the passphrase from stdin rather than from argv so it never lands in shell
 * history or in the process list, and echoes nothing but the resulting hash. The
 * plaintext passphrase is never written to disk by this script.
 */
import { createInterface } from 'node:readline';
import { hashPassphrase, looksLikeArgon2idHash } from '../src/lib/auth/passphrase';

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

  process.stderr.write('\nAdd this to .env.local (or your deploy environment):\n\n');
  // The hash goes to stdout so it can be piped or redirected; all prose goes to stderr.
  process.stdout.write(`APP_PASSPHRASE_HASH='${hash}'\n`);
  process.stderr.write(
    "\nSingle-quoted because the hash contains '$'. Never commit this value.\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
