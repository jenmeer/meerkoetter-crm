# CRM auf der QNAP (TVS-873) mit Tailscale

Ziel: Die Datenbank liegt zu Hause auf der NAS. Unterwegs erreichst nur du das CRM, über ein privates, verschlüsseltes Netz. Im Router wird nichts freigegeben, die NAS bleibt von außen unsichtbar.

```
Handy / Mac (Tailscale-App) ══ WireGuard, Ende-zu-Ende verschlüsselt ══╗
                                                                       ▼
QNAP ─ Container Station ─┬─ Tailscale-Container „crm“  (einziges Gerät im privaten Netz, nur Port 443)
                          └─ CRM-Container             (ohne Root, schreibgeschützt, nur /share/CRM/daten)
```

Die NAS selbst ist **nicht** Teil des privaten Netzes. Selbst mit deinem Handy kommst du darüber nicht an Verwaltung oder Dateien der NAS, sondern nur an das CRM.

## 1. NAS absichern (vorher prüfen)

- **Firmware:** QTS auf den neuesten Stand bringen und automatische Updates einschalten (Systemsteuerung → Firmware-Aktualisierung).
- **Keine automatischen Portfreigaben:** myQNAPcloud → „Automatische Router-Konfiguration“ (UPnP) **ausschalten**, myQNAPcloud Link nicht verwenden.
- **Router prüfen:** Im Router darf keine Portweiterleitung auf die NAS stehen, auch keine alte.
- **Konten:** Standardkonto „admin“ deaktiviert, für dein eigenes Konto die zweistufige Anmeldung einschalten.

## 2. Verschlüsselter Ordner für das CRM

1. Systemsteuerung → Freigabeordner → Erstellen: Name `CRM`, **„Diesen Ordner verschlüsseln“** ankreuzen. Das Passwort sicher aufheben, ohne es sind die Daten verloren.
2. In File Station darin zwei leere Ordner anlegen: `daten` und `tailscale`.
3. `serve.json` aus diesem Ordner nach `CRM/serve.json` kopieren.
4. Speicher & Snapshots: für das Volume stündliche Snapshots einrichten (schützt auch vor Erpressungstrojanern).

Ein verschlüsselter Ordner muss nach einem Neustart der NAS entsperrt werden, sonst startet das CRM nicht. Das ist gewollt: Wer die NAS stiehlt, kommt nicht an die Daten.

## 3. Tailscale einrichten (kostenlos für den privaten Gebrauch)

1. Auf tailscale.com ein Konto anlegen (Anmeldung über Apple, Google oder Microsoft, dort die zweistufige Anmeldung aktiv lassen).
2. Admin-Konsole → **DNS**: „MagicDNS“ und „HTTPS Certificates“ einschalten. Den Namen deines Netzes notieren, er endet auf `.ts.net`.
3. Admin-Konsole → **Access controls**: den Inhalt von `tailscale-regeln.json` einsetzen und speichern. Damit erreichen deine Geräte nur das CRM und sonst nichts.
4. Admin-Konsole → **Settings → Keys → Generate auth key**: nicht wiederverwendbar, nicht ephemer, mit Tag `tag:crm`. Den Schlüssel gleich verwenden, er gilt nur einmal.

## 4. Container starten

1. App Center → **Container Station** installieren.
2. Container Station → Anwendungen → Erstellen → Name `crm`, den Inhalt von `docker-compose.yml` einfügen und darin ersetzen:
   - `${TS_AUTHKEY:-}` durch den Schlüssel aus Schritt 3.4,
   - `${CRM_URL}` durch `https://crm.<dein-netz>.ts.net`.
3. Erstellen. Nach etwa einer Minute erscheint in der Tailscale-Konsole das Gerät `crm`.
4. Danach den Schlüssel in der Anwendung wieder durch einen leeren Wert ersetzen. Die Anmeldung ist im Ordner `tailscale` gespeichert.

## 5. Daten übernehmen und Konto anlegen

1. Am Mac im CRM: Einstellungen → **Daten sichern**.
2. In Container Station die Anwendung `crm` anhalten, die Datei über File Station als `CRM/daten/crm.sqlite` ablegen und die Anwendung wieder starten. Die Datei am Mac danach löschen.
3. Per SSH an der NAS anmelden (nur im Heimnetz) und das Konto anlegen:
   ```bash
   docker exec -it -u crm crm-crm-1 python /app/server.py --data /data --benutzer jens@meerkoetter.at
   ```
   Passwort mit mindestens 12 Zeichen, den angezeigten Schlüssel in die Authenticator-App eintragen.

## 6. Geräte verbinden

- **Handy:** Tailscale-App installieren und anmelden. iPhone: in der App „VPN On Demand“ einschalten, Android: „Immer aktives VPN“. Dann `https://crm.<dein-netz>.ts.net` öffnen, anmelden und als App auf den Home-Bildschirm legen.
- **Mac:** Tailscale-App installieren. In den Datenordner des CRM (`~/Library/Application Support/Meerkoetter-CRM`) eine Datei `server-adresse.txt` mit der Adresse legen. Die Mac-App öffnet dann die NAS statt der lokalen Datenbank. Die lokale Datenbank nicht mehr verwenden, sonst gibt es zwei Stände.

## 7. Sicherung außer Haus

Snapshots schützen vor Fehlern und Trojanern, aber nicht vor Brand oder Diebstahl. Deshalb mit **Hybrid Backup Sync** den Ordner `CRM/daten` täglich sichern, mit eingeschalteter clientseitiger Verschlüsselung, auf eine externe Platte außer Haus oder in einen Cloud-Speicher in der EU. Einmal im Jahr eine Wiederherstellung ausprobieren.

## Updates

Neue Version: In Container Station die Anwendung bearbeiten, bei `ghcr.io/jenmeer/meerkoetter-crm:` die neue Versionsnummer eintragen und neu erstellen. Vor jedem Umbau der Datenbank sichert das CRM sich selbst.

## Was schützt was

| Gefahr | Schutz |
|---|---|
| Angriff aus dem Internet auf die NAS | Kein offener Port, NAS nicht im privaten Netz |
| Fremdes Gerät im privaten Netz | Nur deine angemeldeten Geräte, Regeln erlauben nur das CRM |
| Verlorenes Handy | Tailscale-Gerät in der Konsole entfernen, CRM verlangt zusätzlich Passwort und Code, auf dem Handy liegen keine Kundendaten |
| Gestohlene NAS oder Platte | Verschlüsselter Ordner |
| Erpressungstrojaner | Snapshots, Sicherung außer Haus |
| Lücke im CRM | Container ohne Root, ohne Sonderrechte, schreibgeschützt, sieht nur seinen Datenordner |

Für die Newsletter-Anmeldung über meerkoetter.at folgt ein eigener Schritt: Die Webseite sammelt Anmeldungen, das CRM holt sie ab. So bleibt die NAS auch dafür geschlossen.
