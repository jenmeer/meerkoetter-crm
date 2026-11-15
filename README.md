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

**Daten auf einen anderen Rechner übertragen:** Auf der Übersicht unter **Daten übertragen** auf **Daten sichern** klicken. Die Datei auf den anderen Rechner kopieren und dort mit **Daten einlesen** laden. Der bisherige Stand wird vorher gesichert. Die Datei enthält alle Kundendaten, also sorgsam damit umgehen.

## Bilanz-Import

Bilanzen lassen sich als kopierter Seitentext von openfirmenbuch.at, als Screenshot oder als Jahresabschluss-PDF einfügen. Die Texterkennung läuft offline über das Betriebssystem: am Mac mit Vision, unter Windows mit der eingebauten Windows-Texterkennung. PDFs liest am Mac PDFKit, unter Windows das mitgelieferte Modul pypdf.

## Entwicklung

```bash
python3 server.py                       # im Browser unter http://127.0.0.1:4390, nur Standardbibliothek
pip install -r requirements.txt pillow  # für App-Fenster, Tests und Build
python tests/test_app.py                # Test mit leerem Datenordner
pyinstaller --noconfirm packaging/crm.spec
```

Bei jedem Push baut GitHub Actions beide Versionen und testet sie. Ein Tag wie `v1.0.1` erzeugt ein Release mit den Installationsdateien. Vorher die Versionsnummer in `server.py` (`VERSION`) anpassen.

Schriften: Lora und Poppins stehen unter der SIL Open Font License.
