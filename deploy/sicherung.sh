#!/bin/sh
# Nächtliche Sicherung: konsistente Kopie der Datenbank, verschlüsselt mit age an Jens' öffentlichen Schlüssel.
# Den privaten Schlüssel gibt es nur am Mac. Selbst wer den Server übernimmt, kann alte Sicherungen nicht lesen.
# Aufruf per systemd-Timer oder cron als Benutzer crm, zum Beispiel täglich 03:15.
set -eu
DATA=/var/lib/meerkoetter-crm
OUT=/var/lib/meerkoetter-crm/verschluesselt
KEY=/opt/meerkoetter-crm/deploy/sicherung-empfaenger.txt   # öffentlicher age-Schlüssel (age1…)
mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sqlite3 "$DATA/crm.sqlite" ".backup '$TMP/crm.sqlite'"
age -R "$KEY" -o "$OUT/crm-$(date +%F).sqlite.age" "$TMP/crm.sqlite"
# 30 Tage aufheben
ls -1t "$OUT"/crm-*.sqlite.age | tail -n +31 | xargs -r rm --
