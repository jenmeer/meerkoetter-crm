# Meerkötter CRM als Container (QNAP Container Station, jeder Linux-Server).
# Läuft im Server-Modus mit Anmeldung; Texterkennung mit Tesseract, PDFs mit pypdf.
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu sqlite3 \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir pypdf==7.1.0 \
 && useradd --system --uid 10001 --home-dir /data --no-create-home crm

WORKDIR /app
COPY server.py ./
COPY static ./static
COPY deploy/qnap/start.sh /usr/local/bin/crm-start
RUN chmod 755 /usr/local/bin/crm-start

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 4390
HEALTHCHECK --interval=60s --timeout=5s \
  CMD python -c "import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:4390/auth/status', headers={'Host': '127.0.0.1:4390'}), timeout=4)"
ENTRYPOINT ["crm-start"]
