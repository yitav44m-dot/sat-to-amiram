FROM node:20-slim
# pdftotext (poppler) is the one runtime dependency outside Node.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
