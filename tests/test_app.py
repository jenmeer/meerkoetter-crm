"""Prüft das CRM auf dem jeweiligen Betriebssystem: Server, Datensicherung, Texterkennung und PDF.

Läuft auf GitHub für Mac und Windows mit einem leeren Testordner, nie mit echten Daten.
Aufruf: python tests/test_app.py
"""
import io
import json
import re
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def call(port, path, data=None, content_type="application/json", token=None, method=None):
    headers = {"Content-Type": content_type} if data is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=180) as res:
        body = res.read()
        return json.loads(body) if res.headers.get_content_type() == "application/json" else body


def balance_image():
    """Bild wie ein Screenshot von openfirmenbuch.at, mit Kopf und Bilanzposten."""
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new("RGB", (1400, 640), "white")
    draw = ImageDraw.Draw(image)
    candidates = ["arial.ttf", "Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "DejaVuSans.ttf"]
    font = big = None
    for name in candidates:
        try:
            font, big = ImageFont.truetype(name, 30), ImageFont.truetype(name, 44)
            break
        except OSError:
            continue
    if font is None:
        raise SystemExit("Keine Schrift für das Testbild gefunden")
    draw.text((40, 30), "Muster Bau GmbH", fill="black", font=big)
    draw.text((40, 95), "FN 504330m", fill="black", font=font)
    rows = [("Bilanzsumme", "€ 2.400.000"), ("Eigenkapital", "€ 900.000"),
            ("Kassenbestand, Schecks, Guthaben bei Kreditinstituten", "€ 610.000"),
            ("Verbindlichkeiten", "€ 1.300.000"), ("Bilanzgewinn", "€ 210.000")]
    for i, (label, amount) in enumerate(rows):
        draw.text((40, 200 + i * 80), label, fill="black", font=font)
        draw.text((1000, 200 + i * 80), amount, fill="black", font=font)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def balance_pdf():
    """Kleine PDF mit Text, wie ein Jahresabschluss aus dem Firmenbuch."""
    lines = ["FIRMA", "Muster Bau GmbH", "FN 504330m", "Bilanzstichtag: 31.12.2024", "Auszug aus der Bilanz",
             "Summe Aktiva 2.400.000,00 2.100"]
    content = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({t}) Tj T*" for t in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def main():
    port = free_port()
    with tempfile.TemporaryDirectory() as folder:
        httpd = server.create_server(port, Path(folder) / "daten")
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            meta = call(port, "/api/meta")
            assert meta["version"] == server.VERSION, meta
            company = call(port, "/api/companies", json.dumps({"name": "Probe GmbH"}).encode())
            assert company["legal_form"] == "GmbH", company
            print("Server und Datenbank: ok")

            backup = call(port, "/api/backup")
            assert backup.startswith(b"SQLite format 3\x00")
            restored = call(port, "/api/restore", backup, "application/octet-stream")
            assert restored["companies"] == 1, restored
            print("Daten sichern und einlesen: ok")

            # Personen: Firmenkontakt und Privatkunde zugleich, Haushalt, Verbindung
            body = lambda d: json.dumps(d).encode()
            person = call(port, "/api/contacts", body({"first_name": "Max", "last_name": "Probe", "company_id": company["id"],
                                                     "link_kind": "Geschäftsführung", "private": True, "household": "Familie Probe"}))
            child = call(port, "/api/contacts", body({"first_name": "Lisa", "last_name": "Probe", "private": True, "household": "Familie Probe"}))
            call(port, f"/api/contacts/{child['id']}/relations", body({"kind": "kind", "other_id": person["id"]}))
            card = call(port, f"/api/contacts/{person['id']}")
            assert card["companies"][0]["kind"] == "Geschäftsführung" and card["private"] == 1, card
            assert card["relations"][0]["label"] == "Elternteil von" and card["household_members"][0]["id"] == child["id"]
            assert len(call(port, "/api/contacts?bereich=privat")) == 2 and len(call(port, "/api/contacts?bereich=firma")) == 1
            print("Personen, Haushalt und Verbindungen: ok")

            # Schnittstelle für die Webseite: Double-Opt-in und Abmeldung
            token = call(port, "/api/apikeys", body({"name": "Test", "scopes": ["newsletter"]}))["token"]
            signup = call(port, "/v1/newsletter/anmeldung", body({"email": "test@example.com", "consent_text": "Ja, Newsletter"}), token=token)
            assert call(port, "/v1/newsletter/empfaenger", token=token)["recipients"] == []
            call(port, "/v1/newsletter/bestaetigung", body({"token": signup["confirm_token"]}), token=token)
            recipients = call(port, "/v1/newsletter/empfaenger", token=token)["recipients"]
            assert [r["email"] for r in recipients] == ["test@example.com"], recipients
            call(port, "/v1/newsletter/abmeldung", body({"token": recipients[0]["unsubscribe_token"]}), token=token)
            assert call(port, "/v1/newsletter/empfaenger", token=token)["recipients"] == []
            try:
                call(port, "/v1/personen", token=token)
                raise AssertionError("Zugriff ohne Berechtigung war möglich")
            except urllib.error.HTTPError as err:
                assert err.code == 403
            print("Schnittstelle und Einwilligungen: ok")

            text = call(port, "/api/pdf", balance_pdf(), "application/pdf")["text"]
            assert "Bilanzstichtag: 31.12.2024" in text and "2.400.000,00" in text, text
            print("PDF lesen: ok")

            lines = call(port, "/api/ocr", balance_image(), "image/png")["lines"]
            seen = " | ".join(line["text"] for line in lines)
            print("Texterkennung:", ascii(seen))
            # Wie shotAmount in app.js: ein O oder o in einer Zahl ist eine Null.
            seen = re.sub(r"(?<=[€\s.\d])[Oo]+(?=[\d.\s(,|]|$)", lambda m: "0" * len(m[0]), seen)
            assert all(isinstance(line[k], int) for line in lines for k in ("x", "y", "h")), lines
            for expected in ("Bilanzsumme", "Eigenkapital", "2.400.000", "900.000", "504330"):
                assert expected in seen, f"{expected} fehlt"
            print("Texterkennung: ok")
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    main()
