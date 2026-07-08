FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm pack --pack-destination /out

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /tmp/pkg
RUN npm install -g @anthropic-ai/claude-code /tmp/pkg/*.tgz && rm -rf /tmp/pkg
RUN useradd --create-home brownie
USER brownie
WORKDIR /workspace
ENV BROWNIE_LOG_FORMAT=json
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD brownie status --json >/dev/null || exit 1
CMD ["brownie"]
