# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Bam Studio shop — the image Fly runs.
#
# `next build` peaks around 1.6 GB RSS, and the app machine is 512 MB. So the
# build NEVER happens on the app VM: it runs on Fly's remote builder (which is
# what `fly deploy` uses by default) or in CI, and the machine only ever runs
# the finished server — ~150 MB RSS steady state, comfortable in 512 MB.
#
# Stages: deps (npm ci) → build (next build) → runtime (node server.js).
#
# There is deliberately no HEALTHCHECK instruction. Fly Machines do not read
# Docker's health status — the checks that actually gate a rolling deploy and
# route traffic are the ones in fly.toml, so a HEALTHCHECK here would be a
# second timer burning cycles in a 512 MB VM that nothing consumes. One
# health check, defined in one place: see [[http_service.checks]] in fly.toml.
# ---------------------------------------------------------------------------

# node:22-slim (Debian bookworm, glibc) rather than -alpine. Next's prebuilt
# native binaries — the SWC compiler the build stage leans on, and anything
# traced into the standalone tree — target glibc first-class; musl has its own
# separate failure modes for them. The ~25 MB slim costs over alpine is noise
# next to a 512 MB VM, and having both stages on one libc means whatever the
# build traced is guaranteed to load at runtime.
FROM node:22-slim AS base


# --- deps ------------------------------------------------------------------
# Its own stage so only a package.json/lockfile change busts the install layer.
# `npm ci` (not `npm install`) — it installs exactly what package-lock.json
# pins and fails rather than silently updating it.
#
# Dev dependencies are included on purpose: typescript, tailwind and
# eslint-config-next are all needed by `next build`. None of them reach the
# runtime stage — nothing is copied from here except into `build`.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


# --- build -----------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next inlines every NEXT_PUBLIC_* value into the client bundle AT BUILD TIME.
# That is why these are build args and not just runtime env: by the time a Fly
# secret exists the strings are already baked into the JavaScript, so setting
# one later changes nothing the browser sees.
#
# Nothing secret may be added to this list. Build args are recorded in the
# image history and readable by anyone who can pull the image.
# SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
# RESEND_API_KEY and EMAIL_FROM are runtime-only and arrive as Fly secrets.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_ABN
ARG NEXT_PUBLIC_GST_REGISTERED
ARG NEXT_PUBLIC_INSTAGRAM_URL
ARG NEXT_PUBLIC_TIKTOK_URL

# Re-exported as ENV so server components reading process.env during prerender
# see the same values the client bundle was inlined with.
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_ABN=$NEXT_PUBLIC_ABN
ENV NEXT_PUBLIC_GST_REGISTERED=$NEXT_PUBLIC_GST_REGISTERED
ENV NEXT_PUBLIC_INSTAGRAM_URL=$NEXT_PUBLIC_INSTAGRAM_URL
ENV NEXT_PUBLIC_TIKTOK_URL=$NEXT_PUBLIC_TIKTOK_URL
ENV NEXT_TELEMETRY_DISABLED=1

# siteUrl() (lib/stripe.ts) is called at module scope by app/layout.tsx's
# `metadataBase`, and it throws when NEXT_PUBLIC_SITE_URL is unset.
#
# The build does fail without this guard — measured, it exits 1 with
# "Failed to collect page data for /_not-found" and the real reason attached
# as a [cause]. So this is not the only thing standing between us and a bad
# image; it buys two specific things:
#   * it fails in about a second, instead of after a ~30s compile and a ~12s
#     typecheck, which is what you pay to reach page collection;
#   * the top line names the fix (`--build-arg ...`) rather than a Next
#     internal about a route nobody wrote.
# Keep both this and the throw. Neither is redundant.
RUN test -n "$NEXT_PUBLIC_SITE_URL" || { \
      echo "ERROR: NEXT_PUBLIC_SITE_URL is empty."; \
      echo "  Pass it as a build arg, e.g."; \
      echo "    --build-arg NEXT_PUBLIC_SITE_URL=https://bamstudioshop.com"; \
      echo "  Next bakes it into the bundles at build time — verified, the"; \
      echo "  literal ends up inside .next/server/chunks/lib_stripe_ts_*.js —"; \
      echo "  so a Fly secret set after the build is too late to help."; \
      exit 1; \
    }

# THIS STAGE NEEDS OUTBOUND NETWORK. next/font/google downloads Poppins and
# Nunito Sans from Google's font CDN during the build and self-hosts the files
# it gets back (app/layout.tsx). Fly's remote builder and GitHub Actions
# runners both have egress; an air-gapped or firewalled builder fails here.
RUN npm run build


# --- runtime ---------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# Fly's proxy reaches the machine over its private 6PN address, not loopback.
# Next's standalone server binds localhost unless told otherwise, and a
# localhost-only bind is the classic Fly failure: the deploy looks fine, then
# every health check comes back connection-refused. Bind all interfaces.
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Only these three. `output: "standalone"` traces the ~72 MB the server
# actually needs and writes its own minimal node_modules inside
# .next/standalone — copying the 629 MB real node_modules would be pure waste.
# .next/static and public/ are not traced (they are served, not imported), so
# they have to be placed by hand next to server.js.
#
# What each one is load-bearing for, confirmed by assembling this exact tree
# and dropping one line at a time: without .next/static every /_next/static
# chunk and every self-hosted font 404s while the page HTML still returns 200
# — a break a health check cannot see. Without public/ the files in it 404
# (app/favicon.ico survives, it is compiled into the route tree, so that is
# not a usable canary either).
#
# These are NOT --chown=node:node. The runtime user has to READ the app, never
# write it, and running as node over a root-owned tree is what makes a code
# execution bug unable to rewrite server.js or a chunk and persist. Verified:
# the whole tree root-owned with only .next/cache writable serves every route.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# The stock `node` user (uid 1000) ships with the base image — no reason to
# invent another. .next/cache is the one path that must be writable after the
# drop: everything above is root-owned, so if Next ever goes to write its
# fetch/ISR cache it would hit EACCES on a lazy mkdir. Pre-create it, and give
# it to node — this is the only chown in the stage, and that is the point.
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node

EXPOSE 8080

# `node server.js`, not `next start` — Next 16 warns that `next start` does not
# work with output: standalone, and it is right: the standalone tree has no
# `next` CLI in it. server.js is the entrypoint the build generated.
CMD ["node", "server.js"]
