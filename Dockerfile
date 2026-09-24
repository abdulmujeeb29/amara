FROM node:22-bookworm-slim AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/build-assets.mjs scripts/build-assets.mjs
COPY frontend/ frontend/
COPY templates/ templates/
COPY design/preview/styles.css design/preview/calm.css design/preview/raster-map.js design/preview/
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY manage.py gunicorn.conf.py ./
COPY amara/ amara/
COPY reports/ reports/
COPY templates/ templates/
COPY scripts/start.sh scripts/start.sh
COPY scripts/serve.py scripts/serve.py
COPY --from=assets /app/static/ static/
RUN DJANGO_BUILD=True python manage.py collectstatic --noinput \
    && groupadd --system amara \
    && useradd --system --gid amara --home-dir /app amara \
    && chmod +x /app/scripts/start.sh \
    && chown -R amara:amara /app
USER amara
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/readyz/', timeout=4)"
CMD ["/app/scripts/start.sh"]
