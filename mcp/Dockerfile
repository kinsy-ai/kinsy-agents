# The Kinsy remote MCP server (Cloud Run service kinsy-mcp).
# A thin client over https://kinsy.ai/v1: no data, no secrets, no Google Cloud roles.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KINSY_MCP_SERVE=1

WORKDIR /app
COPY requirements.lock ./
RUN pip install --require-hashes -r requirements.lock

COPY kinsy_mcp/ ./kinsy_mcp/

RUN useradd --system --uid 10001 kinsy
USER kinsy

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn kinsy_mcp.server:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
