# syntax=docker/dockerfile:1.7

# Certify360 Marketing OS — API image.
#
# Multi-stage so the runtime image contains no build toolchain, no dev
# dependencies and no source: only a bundled JS entrypoint plus the SQL
# migrations. Runs as a non-root user with no writable filesystem except
# /app/var (requirement 13, "İşletim").

# ---------------------------------------------------------------- deps ------
FROM node:24-alpine AS deps
WORKDIR /app

# Only manifests first, so a source-only change reuses the dependency layer.
COPY package.json package-lock.json ./
COPY packages/config/package.json      packages/config/
COPY packages/contracts/package.json   packages/contracts/
COPY packages/testing/package.json     packages/testing/
COPY packages/ui/package.json          packages/ui/
COPY apps/api/package.json             apps/api/
COPY apps/worker/package.json          apps/worker/
COPY apps/web/package.json             apps/web/

# `npm ci` installs exactly what the lockfile pins — never a floating version.
RUN npm ci --no-audit --fund=false

# --------------------------------------------------------------- build ------
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build -w @c360/api

# ------------------------------------------------------- native modules -----
# The two packages the bundler cannot inline, at the versions the lockfile
# pins, with their own dependencies.
#
# Installed on their own rather than by pruning the full tree: `apps/api`
# depends on Playwright, which is large and pulls browser tooling nothing in
# production uses. Reading the versions out of the lockfile keeps this honest —
# the image gets the same build that was tested, not whatever is newest.
FROM node:24-alpine AS native
WORKDIR /native
COPY package-lock.json ./
RUN node -e "const lock=require('./package-lock.json');\
const at=(name)=>name+'@'+lock.packages['node_modules/'+name].version;\
console.log([at('@resvg/resvg-js'), at('sharp')].join(' '))" > spec \
 && npm install --omit=dev --no-audit --fund=false $(cat spec) \
 && rm -f spec package-lock.json package.json

# ------------------------------------------------------------- runtime ------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# A fixed uid/gid so the Compose `user:` directive and the volume permissions
# agree. Not the stock `node` user, so the app cannot write over node's paths.
RUN addgroup -g 10001 -S c360 \
 && adduser  -u 10001 -S c360 -G c360 \
 && mkdir -p /app/var/storage \
 && chown -R 10001:10001 /app/var

# The packages the bundle could not inline: compiled `.node` binaries.
COPY --from=native --chown=10001:10001 /native/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/apps/api/dist ./dist
# Migrations stay plain reviewable .sql files and are read at runtime.
COPY --chown=10001:10001 apps/api/db ./db

USER 10001:10001
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Signals go straight to node so SIGTERM triggers the graceful shutdown that
# drains in-flight requests.
CMD ["node", "dist/index.js"]
