FROM node:22-slim AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY products/ products/
COPY --from=ui /app/frontend/dist frontend/dist
ENV GROWTHLOOP_DATA=/data
VOLUME /data
WORKDIR /app/backend
EXPOSE 8600
CMD ["uvicorn", "growthloop.api:app", "--host", "0.0.0.0", "--port", "8600"]
