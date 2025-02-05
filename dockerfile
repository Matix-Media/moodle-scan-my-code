FROM node:22-slim AS base

# environment variables

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# Due to key rotation from npm, we need to update corepack
RUN npm install -g corepack@latest

# enable corepack for pnpm package manager
RUN corepack enable

# copy source code

COPY . /app
WORKDIR /app

# install dependencies

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN apt-get update 
RUN apt-get install python3-pip python3-venv libzbar0 -y

# python venv setup

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

# install python dependencies

RUN pip install -Ur /app/qr-code-reader/requirements.txt

# database setup/migration

RUN pnpm run migrate

# startup

CMD [ "pnpm", "start" ]