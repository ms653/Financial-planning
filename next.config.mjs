/**
 * Next.js configuration.
 *
 * Two things here are load-bearing for the Tailscale Serve deployment described in
 * docs/DEPLOYMENT.md — see the comments before changing them.
 */

/**
 * `tailscale serve` terminates TLS on the tailnet hostname and reverse-proxies to
 * the app over plain HTTP on localhost. That means the browser's `Origin` header
 * says `https://laptop.tailnet-name.ts.net` while the app's own `Host` header says
 * `localhost:3000`. Next 14's Server Action CSRF check compares those two and
 * rejects the mismatch with "Invalid Server Actions request", which would break
 * login entirely once Tailscale is in front of the app.
 *
 * `allowedOrigins` is the supported escape hatch. It is env-driven rather than
 * hardcoded because the tailnet hostname differs per machine/tailnet.
 */
const serverActionOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone so the runtime Docker image can ship without
  // devDependencies or a full node_modules tree.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      allowedOrigins: serverActionOrigins,
    },
    /**
     * @node-rs/argon2 loads a prebuilt `.node` binary, which webpack cannot parse and
     * tries to bundle anyway. Marking it external leaves it as a runtime `require`,
     * which is both correct and what lets Next's output tracing copy the right
     * platform binary into .next/standalone.
     *
     * `pg` is listed for the same class of reason: it does optional-dependency
     * resolution (pg-native) at runtime that bundling turns into a build-time error.
     */
    serverComponentsExternalPackages: ['@node-rs/argon2', 'pg'],
  },
};

export default nextConfig;
