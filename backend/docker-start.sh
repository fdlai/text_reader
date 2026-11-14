#!/bin/sh
# What the app's container runs when it starts (see the Dockerfile).
set -e

# Kokoro's model files, the first time (kept in the models volume after).
python -m app.download_models
# The database tables, created or updated to this version of the app.
alembic upgrade head
# 0.0.0.0: reachable from outside the container. compose.yaml decides who
# can actually reach it (this computer only, unless AUDIFIRE_LISTEN says).
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
