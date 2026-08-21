FROM ghcr.io/puppeteer/puppeteer:22

# La imagen de puppeteer ya trae un Chrome instalado y compatible;
# evitamos que npm install descargue otro Chromium distinto.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js aima_logo_cyan.js ./

USER pptruser
EXPOSE 3000
CMD ["node", "server.js"]
