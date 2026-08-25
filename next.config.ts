import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server at `.next/standalone`.
   *
   * The app runs on a 512 MB Fly machine (shared-cpu-1x). Shipping the real
   * `node_modules` would mean a 629 MB layer of which the running server needs
   * almost none; standalone traces the modules actually imported and writes a
   * minimal `node_modules` plus a generated `server.js` into
   * `.next/standalone` — ~72 MB of deployable tree, 24 MB gzipped.
   *
   * Two consequences the Dockerfile has to honour, and does:
   *
   *  1. `.next/static` and `public/` are NOT traced, because they are served
   *     as files rather than imported. They have to be copied next to
   *     `server.js` by hand or every asset 404s.
   *
   *  2. The standalone server does NOT read `.env.local` (or any `.env*`
   *     file). Every runtime value must arrive as a real process env var —
   *     Fly secrets — and every NEXT_PUBLIC_* value must be present at BUILD
   *     time, because Next inlines those into the bundles then. Setting one
   *     as a Fly secret afterwards changes nothing the browser sees.
   *
   * Start it with `node server.js`, not `next start`: the standalone tree has
   * no `next` CLI in it.
   */
  output: "standalone",
};

export default nextConfig;
