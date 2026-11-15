# CRM Jens Meerkötter

Lokale Kontakt- und Kundenverwaltung. Sie läuft nur auf diesem Mac und ist von außen nicht erreichbar.

## Starten

**Als App (empfohlen):** Meerkoetter CRM aus dem Ordner Programme (Mac) oder dem Startmenü (Windows) öffnen. Installation und Updates siehe README.md, die Installationsdateien liegen auf GitHub unter Releases. Das CRM öffnet sich in einem eigenen Fenster, Schließen beendet es.

**Ohne Installation (Entwicklung):** Doppelklick auf `CRM starten.command`. Der Browser öffnet `http://127.0.0.1:4390`. Das Terminal-Fenster muss offen bleiben, solange du das CRM benutzt. Beenden mit Strg+C oder durch Schließen des Fensters.

Nach einer Programmänderung das Terminal-Fenster schließen und neu starten, sonst läuft noch die alte Version.

## Aufbau

- **Firmen:** Baum aus Muttergesellschaft, Töchtern und Ansprechpartnern. Status, Quelle und Empfehler gehören zur Firma, Ansprechpartner übernehmen sie.
- **Kontakte:** alle Personen. Personen ohne Firma führen Status und Quelle selbst.
- **Pipeline:** Firmen und Privatpersonen von Potential bis Kunde.
- **Empfehler:** wer empfohlen hat, was vereinbart ist, welche Provisionen offen oder bezahlt sind. Grundgerüst ohne Berechnung.

## Bilanzen aus dem Firmenbuch

Auf der Firmenseite unter „Bewertung“: „Aus Firmenbuch einfügen“ nimmt den kopierten Seitentext von openfirmenbuch.at oder Screenshots an (Cmd+V, hineinziehen oder „Bilder auswählen“). Screenshots liest die in macOS eingebaute Texterkennung (`ocr.js`), offline; die Bilder werden nur kurz in einem temporären Ordner verarbeitet und nicht gespeichert. Vor dem Speichern prüft das CRM, ob Aktiva und Passiva die Bilanzsumme ergeben.

Gibt es die Firma noch nicht, legt „Firma aus Bilanz anlegen“ auf der Firmenseite sie direkt an: Firmenname und Firmenbuchnummer kommen aus dem Seitentext, der PDF oder einem Screenshot, der den Kopf der Firmenseite mit zeigt. Findet das CRM eine vorhandene Firma mit gleichem Namen oder gleicher Nummer, bietet es an, die Bilanz dort zu übernehmen. Neue Firmen bekommen Status Potential und Quelle Eigene Recherche.

Auch Jahresabschlüsse als PDF aus dem Firmenbuch lassen sich hineinziehen (`pdftext.js`, ebenfalls offline). Daraus kommen Jahr des Bilanzstichtags, Firmenbuchnummer und Bilanz; die Vorjahresspalte (auf TEUR gerundet) nur, wenn es für das Jahr noch keine Bilanz gibt. Eingescannte PDFs ohne Text gehen nicht. Weicht der Firmenname in den Unterlagen ab, wird erst nach ausdrücklicher Bestätigung gespeichert.

## Bewertung der Bilanz

Vorschlag, die Schwellen stehen in `server.py` unter `RATING`. Bewertet wird die jüngste erfasste Bilanz:

| Merkmal | Punkte |
|---|---|
| Anlagefähige Mittel (liquide Mittel + Wertpapiere) ab 500.000 / 150.000 / 50.000 € | 3 / 2 / 1 |
| Eigenkapitalquote ab 40 % / 20 % | 2 / 1 |
| Bilanzgewinn positiv | 1 |
| Eigenkapital höher als im Vorjahr | 1 |

A ab 5 Punkten, B ab 3, sonst C. Negatives Eigenkapital ergibt immer C. Eine eigene Einstufung an der Firma geht vor. Auf der Firmenseite steht zu jeder Einstufung eine Begründung in ganzen Sätzen, die aus denselben Zahlen entsteht und auch sagt, was zur nächsten Stufe fehlt.

## Wo die Daten liegen

`~/Library/Application Support/Meerkoetter-CRM/` (Mac) beziehungsweise `%LOCALAPPDATA%\Meerkoetter-CRM` (Windows)

- `crm.sqlite`: die Datenbank
- `Sicherungen/`: eine Sicherung pro Starttag, die letzten 30 bleiben erhalten. Vor einem Umbau der Datenbank wird zusätzlich gesichert.

Der Ordner liegt bewusst außerhalb der Dropbox: Eine laufende Datenbank kann durch Synchronisierung beschädigt werden, und Kundendaten bleiben so auf deinem Rechner. Die Dateien im Ordner `JM-CRM` enthalten nur das Programm, keine Kundendaten.

Geht der Mac verloren, sind die Daten nur über eine eigene Sicherung (zum Beispiel Time Machine) wiederherstellbar.

## Technik

Python 3 ohne zusätzliche Pakete (die App bringt zusätzlich pywebview für das Fenster und pypdf für PDFs unter Windows mit), SQLite, Oberfläche in reinem JavaScript. Schrift und Logo liegen lokal, es werden keine externen Dienste aufgerufen.
