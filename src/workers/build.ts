/**
 * Bundles `simulationWorker.ts` into a single self-contained CommonJS file via esbuild,
 * rather than relying on Next's `output: 'standalone'` file tracing to discover it.
 *
 * Next has no documented/supported bundling story for a `node:worker_threads` entry
 * point spawned via a dynamic path — betting on undocumented webpack tracer behaviour
 * for something this load-bearing (a missing worker file means every simulation run
 * silently fails in production) isn't worth the risk. `pg` and `@node-rs/argon2` are
 * marked external for the same reason `next.config.mjs`'s `serverComponentsExternalPackages`
 * does: both ship prebuilt native binaries that a bundler can't and shouldn't inline.
 * Left external, the worker's `require('pg')` resolves at runtime against whatever
 * `node_modules` sits alongside the bundle — which is exactly why the production build
 * writes this file *inside* `.next/standalone` (see `scripts/build-worker.ts`): Next's
 * own tracer already populated `.next/standalone/node_modules/pg` for the main app, and
 * the worker bundle rides along for free with zero Dockerfile change.
 */

import path from 'node:path';
import { build } from 'esbuild';

const WORKER_ENTRY = path.join(process.cwd(), 'src/workers/simulationWorker.ts');
const TSCONFIG = path.join(process.cwd(), 'tsconfig.json');

export async function buildSimulationWorkerBundle(outfile: string): Promise<void> {
  await build({
    entryPoints: [WORKER_ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    tsconfig: TSCONFIG,
    external: ['pg', '@node-rs/argon2'],
    logLevel: 'silent',
  });
}
