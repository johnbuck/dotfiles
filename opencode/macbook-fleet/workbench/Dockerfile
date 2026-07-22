# Shared workbench image: one dev environment for all projects under ~/projects.
# Toolchain baked in: Python 3.12 + uv, Node 20 + npm, git, plus ruff, mypy, pytest.
# Frontend and mobile tooling (Vite, React, Expo, eslint, prettier) install via npm per project as needed.
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1

# git, curl, build basics, and Node 20 from NodeSource.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir uv ruff mypy pytest \
 && groupadd -g 1001 dev \
 && useradd -u 1001 -g 1001 -m -d /home/dev -s /bin/bash dev

# Run as the operator's uid/gid (1001) so files written into the mounted ~/projects
# stay owned by the operator, never root.
USER dev
ENV HOME=/home/dev
WORKDIR /workspace
