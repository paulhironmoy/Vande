# VANDE Cricket render service: a Cloud Run job (docs/YOUTUBE_OPERATIONS.md, docs/INFRASTRUCTURE.md).
# Build from the repository root after `npm run build` (dist/ must contain render.html):
#   docker build -f render-service/Dockerfile -t vande-render .
# Runtime environment: WORKER_URL, RENDER_KEY (secret), optional MAX_JOBS, TIME_BUDGET_MS, CAPTURE_FORMAT, JPEG_QUALITY.
# Egress: the Worker only (the page is served from loopback; renderer.ts aborts every other request).
FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY render-service/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY render-service/src ./src
COPY dist ./dist

ENV NODE_ENV=production \
    RENDER_PAGE_DIR=/app/dist \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TMPDIR=/tmp

USER pwuser
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/main.ts"]
