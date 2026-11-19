# CRM zentral betreiben

Ziel: Das CRM läuft auf einem eigenen kleinen Server in der EU. Am Handy nutzt du es als installierte Webapp, am Mac die App oder den Browser. Alle Geräte sehen denselben Stand.

```
Handy (Webapp) ─┐
Mac (App)      ─┼─ HTTPS ─▶ crm.meerkoetter.at ─▶ Caddy ─▶ CRM (nur 127.0.0.1) ─▶ SQLite auf verschlüsselter Platte
Webseite (/v1) ─┘                                                         └─▶ nächtliche Sicherung, verschlüsselt mit age
```

## Warum nicht der Webspace der Webseite

- **Keine Laufzeit für das CRM:** Der Webspace führt PHP aus, das CRM ist ein dauerhaft laufendes Python-Programm. Dafür müsste es neu geschrieben werden.
- **Geteilt mit WordPress:** Die Kundendaten lägen neben der Webseite. WordPress mit seinen Plugins ist das häufigste Einfallstor. Wird die Webseite übernommen, wären die Kundendaten gleich mit betroffen.
- **Wenig Kontrolle:** Verschlüsselung der Platte, Firewall, Updates und Protokolle bestimmt der Hoster.

Der Webspace bleibt für die Webseite. Das Newsletter-Formular dort ruft die Schnittstelle des CRM über HTTPS auf.

## Einmalige Einrichtung (etwa eine Stunde)

1. **Server mieten:** Kleinster Cloud-Server mit Debian 12 in Deutschland oder Österreich (zum Beispiel Hetzner CX22 oder netcup VPS, um 5 € im Monat). Mit dem Anbieter den Vertrag zur Auftragsverarbeitung (AVV) abschließen, das geht meist mit einem Klick im Kundenbereich.
2. **Anmeldung nur mit Schlüssel:** Beim Anlegen den SSH-Schlüssel vom Mac hinterlegen. Anmeldung mit Passwort und als root abschalten.
3. **Subdomain:** Beim Domain-Anbieter `crm.meerkoetter.at` als A-Eintrag auf die Adresse des Servers zeigen lassen.
4. **Grundschutz:**
   ```bash
   apt update && apt install -y unattended-upgrades ufw caddy python3-venv sqlite3 age tesseract-ocr tesseract-ocr-deu
   ufw allow 22/tcp && ufw allow 443/tcp && ufw allow 80/tcp && ufw enable
   ```
   Port 80 braucht Caddy nur, um das Zertifikat zu holen und auf HTTPS umzuleiten.
5. **Programm:**
   ```bash
   useradd --system --home /var/lib/meerkoetter-crm --shell /usr/sbin/nologin crm
   git clone https://github.com/jenmeer/meerkoetter-crm /opt/meerkoetter-crm
   python3 -m venv /opt/meerkoetter-crm/venv && /opt/meerkoetter-crm/venv/bin/pip install pypdf==7.1.0
   install -d -o crm -g crm -m 700 /var/lib/meerkoetter-crm
   ```
6. **Daten übernehmen:** Am Mac unter Einstellungen → „Daten sichern“, die Datei per `scp` auf den Server kopieren und als `/var/lib/meerkoetter-crm/crm.sqlite` ablegen (Eigentümer `crm`, Rechte 600). Danach die Datei am Mac und auf dem Weg dorthin löschen.
7. **Konto anlegen:**
   ```bash
   sudo -u crm /opt/meerkoetter-crm/venv/bin/python /opt/meerkoetter-crm/server.py --data /var/lib/meerkoetter-crm --benutzer jens@meerkoetter.at
   ```
   Passwort mit mindestens 12 Zeichen wählen, den angezeigten Schlüssel in die Authenticator-App eintragen (zum Beispiel 1Password, Microsoft oder Google Authenticator).
8. **Dienst und HTTPS:** `deploy/meerkoetter-crm.service` nach `/etc/systemd/system/` kopieren, `deploy/Caddyfile` nach `/etc/caddy/Caddyfile`, dann
   ```bash
   systemctl daemon-reload && systemctl enable --now meerkoetter-crm && systemctl reload caddy
   ```
9. **Sicherung:** Am Mac `age-keygen -o ~/.crm-sicherung.key` ausführen. Die Zeile `age1…` (öffentlicher Schlüssel) kommt auf den Server in `deploy/sicherung-empfaenger.txt`. `deploy/sicherung.sh` jede Nacht als Benutzer `crm` laufen lassen und die Dateien regelmäßig auf den Mac holen. Den privaten Schlüssel zusätzlich offline aufheben, ohne ihn sind die Sicherungen nicht lesbar.
10. **Mac-App umstellen:** In den Datenordner am Mac eine Datei `server-adresse.txt` mit `https://crm.meerkoetter.at` legen. Die App öffnet dann den Server statt der lokalen Datenbank.
11. **Handy:** `https://crm.meerkoetter.at` öffnen und anmelden. iPhone: Teilen → „Zum Home-Bildschirm“. Android: Menü → „App installieren“.

## Was die Daten schützt

| Ebene | Schutz |
|---|---|
| Übertragung | Nur HTTPS (TLS 1.2/1.3), HSTS, Zertifikat automatisch |
| Zugang | Passwort (scrypt) und Einmalcode, Sperre nach 5 Fehlversuchen, Begrenzung je Adresse, Sitzung endet nach 8 Stunden ohne Aktivität |
| Sitzung | Cookie nur über HTTPS, für Skripte unsichtbar, nur von der eigenen Seite |
| Programm | Lauscht nur auf 127.0.0.1, eigener Benutzer ohne Rechte, darf nur in den Datenordner schreiben |
| Server | Nur Ports 22 (Schlüssel), 80 und 443 offen, automatische Sicherheitsupdates |
| Speicher | Datenordner nur für den Dienst lesbar. Die Platte eines Cloud-Servers ist nicht von selbst verschlüsselt. Wer das will, legt die Daten auf ein LUKS-Volume, muss es aber nach jedem Neustart mit einer Passphrase öffnen. |
| Sicherung | Täglich, mit age verschlüsselt, privater Schlüssel nur bei dir |
| Nachvollziehbarkeit | Anmeldeversuche, Geräte und Zugriffe der Webseite in den Einstellungen sichtbar |
| Webseite | Eigene Zugangsschlüssel mit eng begrenzten Rechten, jederzeit sperrbar |

## Laufende Pflege

- **Updates des CRM:** `cd /opt/meerkoetter-crm && git pull && systemctl restart meerkoetter-crm`. Vor jedem Umbau sichert das CRM sich selbst.
- **Kontrolle:** Einmal im Monat in den Einstellungen die Geräte und Anmeldeversuche ansehen und einen Blick auf die Sicherungen werfen.
- **Wiederherstellung:** Einmal im Jahr testen, ob sich eine Sicherung am Mac öffnen lässt.
