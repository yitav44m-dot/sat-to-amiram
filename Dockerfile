# The parser was developed against xpdf's pdftotext (the build Git for
# Windows ships), whose -layout output differs from poppler's enough that
# poppler drops the reading-comprehension section and most of the answer
# key. xpdf is built from source here because no Debian package exists,
# and because NITE marks a few sittings "no copying" (spring 2019), which
# the upstream binary honours and the Git for Windows build does not.
FROM debian:bookworm-slim AS xpdf
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL https://dl.xpdfreader.com/xpdf-4.06.tar.gz | tar xz --strip-components=1 \
  && sed -i 's/!doc->okToCopy()/gFalse/' xpdf/pdftotext.cc \
  && cmake -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --target pdftotext -j"$(nproc)"

FROM node:20-slim
COPY --from=xpdf /src/build/xpdf/pdftotext /usr/local/bin/pdftotext
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
