FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm pack --pack-destination /out

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    docker-ce-cli \
    docker-compose-plugin \
    python3 \
    python3-pip \
    python3-venv \
    gh \
    jq \
    ripgrep \
    make \
    build-essential \
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
