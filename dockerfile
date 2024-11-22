FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED 1
RUN corepack enable
COPY . /app
WORKDIR /app

RUN pnpm install --frozen-lockfile

RUN apt-get update 
RUN apt-get install python3-pip python3-venv libzbar0 -y

# python package installation

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

RUN pip install -Ur /app/qr-code-reader/requirements.txt

RUN pnpm run migrate

CMD [ "pnpm", "start" ]