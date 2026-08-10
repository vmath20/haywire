# Haywire API — AST knowledge-graph builder for GitHub repos
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY .python-version* ./

ENV HAYWIRE_DATA=/tmp/haywire-data
ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV HAYWIRE_CORS_ORIGINS=*
ENV HAYWIRE_CORS_ORIGIN_REGEX=.*

RUN mkdir -p /tmp/haywire-data

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
