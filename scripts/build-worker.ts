/**
 * Bundles the simulation worker into `.next/standalone/workers/simulationWorker.js`.
 * Run after `next build` (see `package.json`'s `build` script) so `.next/standalone`
 * already exists — this writes into it rather than replacing it.
 *
 *   npm run build:worker
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { buildSimulationWorkerBundle } from '../src/workers/build';

async function main(): Promise<void> {
  const standaloneDir = path.join(process.cwd(), '.next/standalone');
  if (!existsSync(standaloneDir)) {
    process.stderr.write(
      `${standaloneDir} does not exist — run "next build" first (this script writes into its output, it does not replace it).\n`,
    );
    process.exit(1);
  }

  const outfile = path.join(standaloneDir, 'workers/simulationWorker.js');
  await buildSimulationWorkerBundle(outfile);
  process.stdout.write(`Built ${outfile}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
