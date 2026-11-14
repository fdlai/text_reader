# The whole app as one image: the frontend is built with Node, then served
# by the backend, which also runs the speech engines. Used by compose.yaml.

# 1. Build the frontend into plain files (dist/).
FROM node:22-slim AS frontend
WORKDIR /frontend
# Dependencies first: this step is only redone when they change, not on
# every code change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The backend.
FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# The Docker command-line tool, which the Qwen add-on uses to start Qwen's
# container (see compose.qwen.yaml). Without the add-on it isn't connected
# to anything.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY backend/alembic.ini backend/docker-start.sh ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY --from=frontend /frontend/dist ./frontend
ENV FRONTEND_DIR=/app/frontend
EXPOSE 8000
CMD ["sh", "docker-start.sh"]
