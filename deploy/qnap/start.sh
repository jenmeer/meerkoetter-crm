#!/bin/sh
# Startet das CRM ohne Root-Rechte. Als Root nur kurz, um den Datenordner dem Benutzer crm zu geben.
set -eu
if [ -z "${CRM_URL:-}" ]; then
  echo "CRM_URL fehlt (zum Beispiel https://crm.dein-netz.ts.net)." >&2
  exit 1
fi
if [ "$(id -u)" = "0" ]; then
  chown -R crm:crm /data
  chmod 700 /data
  exec setpriv --reuid=crm --regid=crm --init-groups --inh-caps=-all \
    python /app/server.py --data /data --port 4390 --server "$CRM_URL" "$@"
fi
exec python /app/server.py --data /data --port 4390 --server "$CRM_URL" "$@"
