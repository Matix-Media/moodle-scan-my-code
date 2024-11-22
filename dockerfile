FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED 1
RUN corepack enable
COPY . /app
WORKDIR /app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base as runner

COPY --from=prod-deps /app/node_modules /app/node_modules

RUN apt-get update 
RUN apt-get install python3-pip python3-venv libzbar0 -y

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app/qr-code-reader
RUN pip install -Ur /app/qr-code-reader/requirements.txt
WORKDIR /app


WORKDIR /app

RUN pnpm run migrate

EXPOSE 8000
CMD [ "pnpm", "start" ]