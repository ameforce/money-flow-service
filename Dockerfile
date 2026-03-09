FROM node:22-alpine AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
WORKDIR /workspace

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY backend ./backend
COPY --from=frontend-build /workspace/frontend/dist ./frontend/dist

RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .
RUN useradd --create-home --shell /usr/sbin/nologin appuser && chown -R appuser:appuser /workspace

EXPOSE 8000
USER appuser
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-172.30.0.0/24,127.0.0.1,::1}\""]

