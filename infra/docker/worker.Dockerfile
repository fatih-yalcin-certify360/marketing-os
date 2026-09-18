# syntax=docker/dockerfile:1.7

# Certify360 Marketing OS — worker image.
#
# Same posture as the API image: bundled entrypoint, non-root, no build
# toolchain. The worker exposes no port at all — it only ever dials out to
# PostgreSQL and (from Phase 2) the AI provider.

FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/config/package.json      packages/config/
COPY packages/contracts/package.json   packages/contracts/
COPY packages/testing/package.json     packages/testing/
COPY packages/ui/package.json          packages/ui/
COPY apps/api/package.json             apps/api/
COPY apps/worker/package.json          apps/worker/
COPY apps/web/package.json             apps/web/

RUN npm ci --no-audit --fund=false

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
# The worker imports the monolith's modules (ADR-0001), so the API source is
# needed to build it. The dependency runs worker -> api and never the reverse.
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
RUN npm run build -w @c360/worker

# ------------------------------------------------------- native modules -----
# The two packages the bundler cannot inline, at the versions the lockfile
# pins, with their own dependencies. The worker renders images through the same
# code the API does, so it needs them too.
#
# Installed on their own rather than by pruning the full tree, which would drag
# in Playwright and other tooling nothing in production uses.
FROM node:24-alpine AS native
WORKDIR /native
COPY package-lock.json ./
RUN node -e "const lock=require('./package-lock.json');\
const at=(name)=>name+'@'+lock.packages['node_modules/'+name].version;\
console.log([at('@resvg/resvg-js'), at('sharp')].join(' '))" > spec \
 && npm install --omit=dev --no-audit --fund=false $(cat spec) \
 && rm -f spec package-lock.json package.json

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN addgroup -g 10001 -S c360 \
 && adduser  -u 10001 -S c360 -G c360 \
 && mkdir -p /app/var/storage \
 && chown -R 10001:10001 /app/var

# The packages the bundle could not inline: compiled `.node` binaries.
COPY --from=native --chown=10001:10001 /native/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/apps/worker/dist ./dist

USER 10001:10001

# Liveness is proved by claiming work, not by a socket. The worker heartbeats
# every job it holds, and the reaper requeues anything it stops updating — so a
# hung worker is detected by the queue rather than by an HTTP probe.
CMD ["node", "dist/index.js"]
