#!/bin/zsh
# Startet das CRM und öffnet es im Browser. Läuft es schon, wird es nur geöffnet.
cd "$(dirname "$0")" || exit 1
URL="http://127.0.0.1:4390"
if curl -s -o /dev/null "$URL/api/meta"; then
  open "$URL"
  exit 0
fi
(sleep 1; open "$URL") &
exec python3 server.py
