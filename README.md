# Meerkötter CRM

Lokale Kontakt- und Kundenverwaltung für Mac (Apple Silicon) und Windows 11. Alle Daten bleiben auf dem eigenen Rechner. Es gibt keinen Server im Internet und kein Konto.

## Installieren

Die Installationsdateien liegen unter **[Releases](../../releases/latest)**.

### Mac (Apple Silicon, ab macOS 12)

1. `Meerkoetter-CRM-…-Mac-AppleSilicon.dmg` herunterladen und öffnen.
2. **Meerkoetter CRM** in den Ordner **Programme** ziehen.
3. Beim ersten Start meldet macOS, dass die App nicht von Apple geprüft wurde, weil sie nicht über den App Store kommt. So geht es trotzdem:
   - **Mit Rechtsklick öffnen:** Rechtsklick auf die App, dann **Öffnen** und noch einmal **Öffnen**.
   - **Ab macOS 15:** Unter **Systemeinstellungen → Datenschutz & Sicherheit** auf **Dennoch öffnen** klicken.

   Danach startet die App normal per Doppelklick.

### Windows 11

1. `Meerkoetter-CRM-…-Windows-Setup.exe` herunterladen und ausführen.
2. Erscheint „Der Computer wurde durch Windows geschützt“, auf **Weitere Informationen** und dann **Trotzdem ausführen** klicken. Die Meldung kommt, weil das Programm nicht mit einem gekauften Zertifikat signiert ist.
3. Die Installation braucht keine Administratorrechte. Das CRM steht danach im Startmenü.

## Wo die Daten liegen

| System | Ordner |
|---|---|
| Mac | `~/Library/Application Support/Meerkoetter-CRM` |
| Windows | `%LOCALAPPDATA%\Meerkoetter-CRM` |

Beim Start legt das CRM jeden Tag eine Sicherung an, die letzten 30 bleiben erhalten. Beim Deinstallieren oder Aktualisieren bleiben die Daten erhalten.

**Daten auf einen anderen Rechner übertragen:** Unter **Einstellungen → Daten übertragen** auf **Daten sichern** klicken. Die Datei auf den anderen Rechner kopieren und dort mit **Daten einlesen** laden. Der bisherige Stand wird vorher gesichert. Die Datei enthält alle Kundendaten, also sorgsam damit umgehen.

## Bilanz-Import

Bilanzen lassen sich als kopierter Seitentext von openfirmenbuch.at, als Screenshot oder als Jahresabschluss-PDF einfügen. Die Texterkennung läuft offline über das Betriebssystem: am Mac mit Vision, unter Windows mit der eingebauten Windows-Texterkennung. PDFs liest am Mac PDFKit, unter Windows das mitgelieferte Modul pypdf.

## Schnittstelle für die Webseite (`/v1`)

Jeder Aufruf braucht einen Zugangsschlüssel aus **Einstellungen → Schnittstelle für die Webseite**:
`Authorization: Bearer mcrm_…`. Daten gehen als JSON hin und zurück. Jeder Zugriff wird protokolliert, ohne Inhalte.

| Aufruf | Recht | Zweck |
|---|---|---|
| `GET /v1/status` | jedes | Verbindung prüfen |
| `POST /v1/newsletter/anmeldung` | newsletter | `{email, consent_text, first_name?, last_name?, source_url?}` → `{confirm_token}`; die Webseite verschickt damit den Bestätigungslink |
| `POST /v1/newsletter/bestaetigung` | newsletter | `{token}` aus dem Bestätigungslink, 7 Tage gültig, einmal verwendbar |
| `POST /v1/newsletter/abmeldung` | newsletter | `{token}` = persönlicher Abmeldeschlüssel aus der Empfängerliste |
| `GET /v1/newsletter/empfaenger` | newsletter | nur bestätigte, nicht abgemeldete Adressen samt Abmeldeschlüssel |
| `GET /v1/personen?bereich=firma\|privat` | lesen | Grunddaten der Personen mit Firmen und Haushalt |
| `GET /v1/firmen` | lesen | Grunddaten der Firmen |

Einträge haben eine feste Kennung (`uid`), die sich nie ändert. Damit lassen sich die Daten später zwischen Rechnern oder mit einem Server abgleichen.

Hinweis: Die Schnittstelle antwortet nur, wenn das CRM zentral läuft (siehe unten). Auf dem Mac allein ist sie von außen nicht erreichbar.

## Unterwegs: Webapp und zentraler Betrieb

Mit `--server https://crm.meerkoetter.at` läuft das CRM im Server-Modus: Anmeldung mit Passwort und Einmalcode aus einer Authenticator-App, Sitzungen mit Ablauf, Sperre nach Fehlversuchen. Die Oberfläche lässt sich am Handy als Webapp installieren und speichert nur Programmdateien, nie Kundendaten. Einrichtung Schritt für Schritt:

- **Zu Hause auf der QNAP, ohne offenen Port (empfohlen):** [deploy/qnap/ANLEITUNG-QNAP.md](deploy/qnap/ANLEITUNG-QNAP.md), Container `ghcr.io/jenmeer/meerkoetter-crm` mit Tailscale
- **Auf einem eigenen Server:** [deploy/ANLEITUNG-SERVER.md](deploy/ANLEITUNG-SERVER.md)

## Entwicklung

```bash
python3 server.py                       # im Browser unter http://127.0.0.1:4390, nur Standardbibliothek
pip install -r requirements.txt pillow  # für App-Fenster, Tests und Build
python tests/test_app.py                # Test mit leerem Datenordner
pyinstaller --noconfirm packaging/crm.spec
```

Bei jedem Push baut GitHub Actions beide Versionen und testet sie. Ein Tag wie `v1.0.1` erzeugt ein Release mit den Installationsdateien. Vorher die Versionsnummer in `server.py` (`VERSION`) anpassen.

Schriften: Lora und Poppins stehen unter der SIL Open Font License.
