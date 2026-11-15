FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
# rasterio's bundled GDAL needs libexpat at runtime (absent from python:slim)
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api ./api
# writable cache for MOLA areas downloaded on demand (mount a volume here to keep them across restarts)
RUN mkdir -p api/data/dem/ondemand && useradd -r -u 10001 app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os,urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.getenv('PORT','8000'),timeout=4).status==200 else 1)"
# Hosts such as Railway, Render or Cloud Run assign the port through $PORT; 8000 locally and in docker compose.
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
