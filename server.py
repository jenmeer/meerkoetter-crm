#!/usr/bin/env python3
"""Lokales CRM für Jens Meerkötter. Nur Python-Standardbibliothek, nur auf diesem Rechner erreichbar."""
import argparse
import csv
import io
import json
import os
import re
import threading
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = "1.0.0"
# In der gebauten App liegen Programmdateien im Paket (PyInstaller), sonst neben server.py.
APP_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
STATIC_DIR = APP_DIR / "static"


def default_data_dir():
    """Datenablage je Betriebssystem, immer außerhalb von Programmordner und Dropbox."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "Meerkoetter-CRM"
    return Path.home() / "Library" / "Application Support" / "Meerkoetter-CRM"


DEFAULT_DATA_DIR = default_data_dir()
HOST = "127.0.0.1"
MAX_BODY = 1_000_000
MAX_IMAGE = 20_000_000
OCR_SCRIPT = APP_DIR / "ocr.js"
OCR_SCRIPT_WINDOWS = APP_DIR / "ocr.ps1"
PDF_SCRIPT = APP_DIR / "pdftext.js"
MAX_DATABASE = 500_000_000
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # unter Windows kein aufblitzendes Konsolenfenster
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/heic": ".heic", "image/tiff": ".tiff",
               "image/gif": ".gif", "image/webp": ".webp"}
BACKUPS_KEPT = 30
SCHEMA_VERSION = 3
SEARCH_LIMIT = 8  # Treffer je Gruppe in der Ergebnisliste
QUIET_DAYS = 180  # Kundinnen und Kunden ohne Kontakt seit so vielen Tagen werden gemeldet

STATUSES = ["Potential", "Neu", "Erstgespräch", "Beratung", "Kunde", "Ruhend", "Kein Interesse"]
PIPELINE = ["Potential", "Neu", "Erstgespräch", "Beratung", "Kunde"]
KINDS = ["Telefonat", "E-Mail", "Treffen", "Notiz"]
SOURCES = ["Webseite", "Empfehlung", "Eigene Recherche", "LinkedIn", "Veranstaltung", "Podcast", "Sonstiges"]
REFERRAL_SOURCE = "Empfehlung"
CONSENTS = ["Offen", "Vertrag oder Anfrage", "Einwilligung erteilt", "Widerrufen"]
LEGAL_FORMS = ["GmbH", "FlexCo", "AG", "GmbH & Co KG", "KG", "OG", "e.U.", "Verein", "Stiftung", "Sonstige"]
GRADES = ["A", "B", "C"]
COMMISSION_STATES = ["Offen", "Abgerechnet", "Bezahlt"]

# Bewertung der Bilanz: Vorschlag, alle Schwellen lassen sich hier ändern.
RATING = {
    "investable": [(500_000, 3), (150_000, 2), (50_000, 1)],  # liquide Mittel + Wertpapiere in Euro, Punkte
    "equity_ratio": [(40, 2), (20, 1)],  # Eigenkapitalquote in Prozent, Punkte
    "profit_points": 1,  # Bilanzgewinn positiv
    "growth_points": 1,  # Eigenkapital gegenüber Vorjahr gestiegen
    "grade_a": 5,
    "grade_b": 3,
    "max": 7,
}

PERSON_FIELDS = [
    "first_name", "last_name", "email", "phone", "address", "role",
    "source", "status", "consent", "consent_date", "notes",
]
COMPANY_FIELDS = [
    "name", "legal_form", "register_no", "industry", "website", "address", "phone", "phone2", "email",
    "status", "source", "own_grade", "notes",
]
FINANCIAL_NUMBERS = ["total_assets", "equity", "liquid", "securities", "liabilities", "retained"]
REFERRER_FIELDS = ["name", "email", "phone", "commission_terms", "agreement_date", "notes"]

BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Neu',
    consent TEXT NOT NULL DEFAULT 'Offen',
    consent_date TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due TEXT NOT NULL DEFAULT '',
    done_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
"""

MIGRATION_V2_TABLES = [
    """CREATE TABLE referrers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        commission_agreed INTEGER NOT NULL DEFAULT 0,
        commission_terms TEXT NOT NULL DEFAULT '',
        agreement_date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE companies (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        legal_form TEXT NOT NULL DEFAULT '',
        register_no TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        parent_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'Neu',
        source TEXT NOT NULL DEFAULT '',
        referrer_id INTEGER REFERENCES referrers(id) ON DELETE SET NULL,
        own_grade TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE financials (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        total_assets INTEGER,
        equity INTEGER,
        liquid INTEGER,
        securities INTEGER,
        liabilities INTEGER,
        retained INTEGER,
        origin TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (company_id, year)
    )""",
    """CREATE TABLE commissions (
        id INTEGER PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES referrers(id) ON DELETE RESTRICT,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        customer_label TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Offen',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    )""",
    "ALTER TABLE contacts ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL",
    "ALTER TABLE contacts ADD COLUMN role TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE contacts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE contacts ADD COLUMN referrer_id INTEGER REFERENCES referrers(id) ON DELETE SET NULL",
    """CREATE TABLE activities_new (
        id INTEGER PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        date TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        CHECK ((contact_id IS NULL) != (company_id IS NULL))
    )""",
    "INSERT INTO activities_new (id, contact_id, kind, date, text, created_at) "
    "SELECT id, contact_id, kind, date, text, created_at FROM activities",
    "DROP TABLE activities",
    "ALTER TABLE activities_new RENAME TO activities",
    """CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due TEXT NOT NULL DEFAULT '',
        done_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        CHECK ((contact_id IS NULL) != (company_id IS NULL))
    )""",
    "INSERT INTO tasks_new (id, contact_id, title, due, done_at, created_at) "
    "SELECT id, contact_id, title, due, done_at, created_at FROM tasks",
    "DROP TABLE tasks",
    "ALTER TABLE tasks_new RENAME TO tasks",
]

MIGRATION_V2_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done_at, due)",
    "CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(parent_id)",
]


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now():
    return datetime.now().isoformat(timespec="seconds")


def fold(value):
    return (value or "").casefold()


def digits(value):
    return re.sub(r"\D", "", value or "")


def detect_legal_form(name):
    text = fold(name)
    patterns = [
        ("GmbH & Co KG", r"gmbh\s*(&|und)\s*co\.?\s*kg"), ("GmbH", r"\b(gmbh|ges\.?\s*m\.?\s*b\.?\s*h\.?)"),
        ("FlexCo", r"\b(flexco|flexible kapitalgesellschaft)\b"), ("AG", r"\bag$"), ("KG", r"\bkg$"),
        ("OG", r"\bog$"), ("e.U.", r"\be\.?\s*u\.?$"), ("Verein", r"\bverein\b"), ("Stiftung", r"stiftung\b"),
    ]
    for form, pattern in patterns:
        if re.search(pattern, text):
            return form
    return ""


def migrate_v2(conn):
    """Führt die alten Kontakte in Firmen und Ansprechpartner über. Läuft als eine einzige Transaktion."""
    for statement in MIGRATION_V2_TABLES:
        conn.execute(statement)
    stamp = now()
    # Rang für die Übernahme: Der am weitesten fortgeschrittene Status einer Firma gewinnt.
    rank = {"Kunde": 6, "Beratung": 5, "Erstgespräch": 4, "Neu": 3, "Ruhend": 2, "Kein Interesse": 1}
    by_name = {}
    rows = conn.execute("SELECT * FROM contacts WHERE TRIM(company) != '' ORDER BY id").fetchall()
    for row in rows:
        key = fold(row["company"].strip())
        if key not in by_name:
            name = row["company"].strip()
            cur = conn.execute(
                "INSERT INTO companies (name, legal_form, status, source, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, detect_legal_form(name), row["status"], row["source"], row["created_at"], stamp))
            by_name[key] = {"id": cur.lastrowid, "has_primary": False}
        company = by_name[key]
        current = conn.execute("SELECT status, source FROM companies WHERE id = ?", (company["id"],)).fetchone()
        status = row["status"] if rank.get(row["status"], 0) > rank.get(current["status"], 0) else current["status"]
        conn.execute("UPDATE companies SET status = ?, source = ? WHERE id = ?",
                     (status, current["source"] or row["source"], company["id"]))
        if row["first_name"].strip() or row["last_name"].strip():
            conn.execute("UPDATE contacts SET company_id = ?, is_primary = ? WHERE id = ?",
                         (company["id"], 0 if company["has_primary"] else 1, row["id"]))
            company["has_primary"] = True
        else:
            # Eintrag nur mit Firmennamen: Angaben und Verlauf wandern zur Firma, der Personeneintrag entfällt.
            extra = [f"E-Mail: {row['email']}" if row["email"] else "", f"Telefon: {row['phone']}" if row["phone"] else "", row["notes"]]
            extra = "\n".join(part for part in extra if part)
            existing = conn.execute("SELECT notes, address FROM companies WHERE id = ?", (company["id"],)).fetchone()
            notes = "\n".join(part for part in (existing["notes"], extra) if part)
            conn.execute("UPDATE companies SET notes = ?, address = ? WHERE id = ?",
                         (notes, existing["address"] or row["address"], company["id"]))
            for table in ("activities", "tasks"):
                conn.execute(f"UPDATE {table} SET company_id = ?, contact_id = NULL WHERE contact_id = ?",
                             (company["id"], row["id"]))
            conn.execute("DELETE FROM contacts WHERE id = ?", (row["id"],))
    conn.execute("ALTER TABLE contacts DROP COLUMN company")
    for statement in MIGRATION_V2_INDEXES:
        conn.execute(statement)


def migrate_v3(conn):
    """Eigene Felder für Telefon und E-Mail der Firma. Werte aus den Notizen des Imports wandern dorthin."""
    for column in ("phone", "phone2", "email"):
        conn.execute(f"ALTER TABLE companies ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
    labels = {"Telefon": "phone", "Telefon 2": "phone2", "E-Mail": "email"}
    for row in conn.execute("SELECT id, notes FROM companies").fetchall():
        found, kept = {}, []
        for line in row["notes"].split("\n"):
            match = re.fullmatch(r"(Telefon 2|Telefon|E-Mail): (\S.*)", line)
            column = labels[match[1]] if match else None
            if column and column not in found and (column != "email" or re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", match[2])):
                found[column] = match[2]
            else:
                kept.append(line)
        if found:
            sets = ", ".join(f"{c} = ?" for c in found)
            conn.execute(f"UPDATE companies SET {sets}, notes = ? WHERE id = ?",
                         [*found.values(), "\n".join(kept), row["id"]])


class Database:
    def __init__(self, path):
        self.path = path

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.create_function("fold", 1, fold)
        conn.create_function("digits", 1, digits)
        return conn

    def version(self):
        conn = self.connect()
        try:
            return conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()

    def migrate(self, backup_folder):
        conn = self.connect()
        conn.isolation_level = None
        try:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version >= SCHEMA_VERSION:
                return
            conn.executescript(BASE_SCHEMA)
            has_data = conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] > 0
            has_data = has_data or (version >= 2 and conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0] > 0)
            if has_data:
                self.backup_to(backup_folder / f"crm-{date.today().isoformat()}-vor-umbau-v{SCHEMA_VERSION}.sqlite")
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN IMMEDIATE")
            try:
                if version < 2:
                    migrate_v2(conn)
                migrate_v3(conn)
                conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("PRAGMA foreign_keys = ON")
        finally:
            conn.close()

    def backup_to(self, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.parent.chmod(0o700)
        source = self.connect()
        dest = sqlite3.connect(target)
        try:
            source.backup(dest)
        finally:
            dest.close()
            source.close()
        target.chmod(0o600)

    def backup(self, folder):
        """Eine Sicherung pro Tag, die letzten BACKUPS_KEPT bleiben erhalten."""
        target = folder / f"crm-{date.today().isoformat()}.sqlite"
        if not target.exists():
            self.backup_to(target)
        for old in sorted(folder.glob("crm-*.sqlite"))[:-BACKUPS_KEPT]:
            old.unlink()


def valid_date(value, label):
    if value == "":
        return value
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise ApiError(400, f"{label}: Datum ungültig.")


def text_field(value, field):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ApiError(400, f"Feld {field} ungültig.")
    return value.strip()


def body_text(data, field, label, required=True):
    value = text_field(data.get(field, ""), field)
    if required and not value:
        raise ApiError(400, f"Bitte {label} angeben.")
    return value


def valid_email(value):
    if value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        raise ApiError(400, "E-Mail-Adresse ungültig.")
    return value


def valid_website(value):
    if not value:
        return value
    if not re.match(r"[a-z][a-z0-9+.-]*:", value, re.I):
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ApiError(400, "Webseite ungültig.")
    return value


def optional_id(value, label):
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ApiError(400, f"{label} ungültig.")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{label} ungültig.")


def whole_euro(value, label):
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ApiError(400, f"{label}: Zahl ungültig.")
    try:
        number = Decimal(str(value).replace(" ", "").replace(",", "."))
        if not number.is_finite():
            raise InvalidOperation
    except InvalidOperation:
        raise ApiError(400, f"{label}: Zahl ungültig.")
    return int(number.to_integral_value())


def amount_cents(value):
    text = str(value if value is not None else "").strip().replace(" ", "").replace("€", "")
    # Deutsche Schreibweise: Punkt trennt Tausender, Komma die Cent.
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")
    try:
        number = Decimal(text)
        if not number.is_finite() or number <= 0:
            raise InvalidOperation
    except InvalidOperation:
        raise ApiError(400, "Bitte einen Betrag über 0 angeben.")
    return int((number * 100).to_integral_value())


def csv_safe(field, value):
    """Verhindert, dass Tabellenprogramme Zellinhalte als Formel ausführen."""
    text = "" if value is None else str(value)
    if field == "phone" and re.fullmatch(r"\+?[\d\s()/.-]*", text):
        return text
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def like_pattern(query):
    escaped = fold(query).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def points_for(value, steps):
    for threshold, points in steps:
        if value >= threshold:
            return points
    return 0


def rate_company(financials, own_grade=""):
    """Bewertet die jüngste Bilanz. financials: Zeilen, neueste zuerst. Nachvollziehbar statt Black Box."""
    result = {
        "grade": own_grade or None, "own": bool(own_grade), "computed": None, "score": None,
        "max": RATING["max"], "reasons": [], "gaps": [], "year": None,
        "equity_ratio": None, "investable": None, "net_liquidity": None,
    }
    if not financials:
        return result
    latest = financials[0]
    previous = financials[1] if len(financials) > 1 else None
    result["year"] = latest["year"]
    score = 0

    liquid, securities = latest["liquid"], latest["securities"]
    if liquid is None and securities is None:
        result["gaps"].append("Liquide Mittel und Wertpapiere")
    else:
        investable = (liquid or 0) + (securities or 0)
        result["investable"] = investable
        points = points_for(investable, RATING["investable"])
        score += points
        result["reasons"].append({"label": "Anlagefähige Mittel", "points": points, "max": 3})
        if latest["liabilities"] is not None:
            result["net_liquidity"] = investable - latest["liabilities"]

    equity, assets = latest["equity"], latest["total_assets"]
    if equity is None or not assets or assets <= 0:
        result["gaps"].append("Eigenkapital und Bilanzsumme")
    else:
        ratio = round(equity / assets * 100, 1)
        result["equity_ratio"] = ratio
        points = points_for(ratio, RATING["equity_ratio"])
        score += points
        result["reasons"].append({"label": "Eigenkapitalquote", "points": points, "max": 2})

    if latest["retained"] is None:
        result["gaps"].append("Bilanzgewinn")
    else:
        points = RATING["profit_points"] if latest["retained"] > 0 else 0
        score += points
        result["reasons"].append({"label": "Bilanzgewinn positiv", "points": points, "max": 1})

    if previous is None or previous["equity"] is None or equity is None:
        result["gaps"].append("Vorjahresvergleich")
    else:
        points = RATING["growth_points"] if equity > previous["equity"] else 0
        score += points
        result["reasons"].append({"label": "Eigenkapital gestiegen", "points": points, "max": 1})

    negative_equity = equity is not None and equity < 0
    result["negative_equity"] = negative_equity
    if negative_equity or score < RATING["grade_b"]:
        computed = "C"
    elif score >= RATING["grade_a"]:
        computed = "A"
    else:
        computed = "B"
    result["score"] = score
    result["computed"] = computed
    result["grade"] = own_grade or computed
    result["explanation"] = explain_rating(result, latest, previous, own_grade)
    return result


def euro(value):
    """Ganze Euro mit Tausenderpunkt, Minus als echtes Minuszeichen."""
    text = f"{abs(round(value)):,}".replace(",", ".")
    return f"\u2212{text} \u20ac" if value < 0 else f"{text} \u20ac"


def plural(points):
    return "1 Punkt" if points == 1 else f"{points} Punkte"


def explain_rating(r, latest, previous, own_grade):
    """Begründung der Einstufung in ganzen Sätzen, aus denselben Werten wie die Punkte."""
    points = {x["label"]: x["points"] for x in r["reasons"]}
    sentences = []
    equity = latest["equity"]
    if r.get("negative_equity"):
        sentences.append(f"Eigenkapital negativ ({euro(equity)}), deshalb unabhängig von den anderen Werten C.")

    if r["investable"] is not None:
        value, got = r["investable"], points["Anlagefähige Mittel"]
        next_step = [(t, p) for t, p in reversed(RATING["investable"]) if p > got]
        more = f", {plural(next_step[0][1])} ab {euro(next_step[0][0])}" if next_step else ""
        if value <= 0:
            sentences.append(f"Keine anlagefähigen Mittel ({euro(value)}, {plural(got)}{more}).")
        else:
            word = {3: "Hohe", 2: "Gute", 1: "Überschaubare"}.get(got, "Kaum")
            sentences.append(f"{word} anlagefähige Mittel von {euro(value)} ({plural(got)}{more}).")

    if r["equity_ratio"] is not None:
        ratio, got = r["equity_ratio"], points["Eigenkapitalquote"]
        shown = f"{abs(ratio):.1f}".replace(".", ",").removesuffix(",0")
        shown = f"\u2212{shown}" if ratio < 0 else shown
        if got == 2:
            text = f"Eigenkapitalquote {shown} %, hoch ({plural(got)})"
        elif got == 1:
            text = f"Eigenkapitalquote {shown} %, solide ({plural(got)}, 2 Punkte ab 40 %)"
        elif ratio < 0:
            text = f"Eigenkapitalquote {shown} %, negativ (0 Punkte)"
        else:
            text = f"Eigenkapitalquote {shown} %, niedrig (0 Punkte, 1 Punkt ab 20 %)"
        sentences.append(f"{text}.")

    if latest["retained"] is not None:
        value, got = latest["retained"], points["Bilanzgewinn positiv"]
        if value > 0:
            text = f"Bilanzgewinn von {euro(value)}"
        elif value < 0:
            text = f"Bilanzverlust von {euro(-value)}"
        else:
            text = "Kein Bilanzgewinn"
        sentences.append(f"{text} ({plural(got)}).")

    if "Eigenkapital gestiegen" in points:
        before, got = previous["equity"], points["Eigenkapital gestiegen"]
        if equity > before:
            text = f"Eigenkapital gestiegen, von {euro(before)} auf {euro(equity)}"
        elif equity < before:
            text = f"Eigenkapital gesunken, von {euro(before)} auf {euro(equity)}"
        else:
            text = f"Eigenkapital unverändert bei {euro(equity)}"
        sentences.append(f"{text} ({plural(got)}).")

    if r["gaps"]:
        sentences.append(f"Nicht bewertet, weil Angaben fehlen: {', '.join(r['gaps'])}.")

    # Was zur nächsten Stufe fehlt und wo es am ehesten zu holen wäre.
    target = None
    if not r.get("negative_equity"):
        if r["computed"] == "B":
            target = ("A", RATING["grade_a"])
        elif r["computed"] == "C":
            target = ("B", RATING["grade_b"])
    if target:
        missing = target[1] - r["score"]
        options = []
        names = {
            "Anlagefähige Mittel": "mehr Liquidität", "Eigenkapitalquote": "eine höhere Eigenkapitalquote",
            "Bilanzgewinn positiv": "einen Bilanzgewinn", "Eigenkapital gestiegen": "wachsendes Eigenkapital",
        }
        open_points = sorted((x for x in r["reasons"] if x["points"] < x["max"]), key=lambda x: x["points"] - x["max"])
        options = [names[x["label"]] for x in open_points][:2]
        if r["gaps"]:
            options.append("die fehlenden Angaben")
        listed = ", ".join(options[:-1]) + " oder " + options[-1] if len(options) > 1 else "".join(options)
        hint = f", am ehesten über {listed}" if options else ""
        sentences.append(f"Für {target[0]} {'fehlt' if missing == 1 else 'fehlen'} {plural(missing)}{hint}.")
    elif r["computed"] == "A":
        word = "knapp" if r["score"] == RATING["grade_a"] else "klar"
        sentences.append(f"Damit {word} A ({r['score']} von {r['max']} Punkten, A ab {RATING['grade_a']}).")

    if own_grade:
        if own_grade == r["computed"]:
            sentences.append(f"Deine eigene Einstufung {own_grade} stimmt mit der Rechnung überein.")
        else:
            sentences.append(f"Du hast selbst {own_grade} eingestuft, die Rechnung ergäbe {r['computed']}.")
    return sentences


COMPANY_LAST_CONTACT = (
    "(SELECT MAX(a.date) FROM activities a WHERE a.kind != 'System' AND (a.company_id = co.id "
    "OR a.contact_id IN (SELECT id FROM contacts WHERE company_id = co.id)))"
)
COMPANY_OPEN_TASKS = (
    "(SELECT COUNT(*) FROM tasks t WHERE t.done_at = '' AND (t.company_id = co.id "
    "OR t.contact_id IN (SELECT id FROM contacts WHERE company_id = co.id)))"
)
COMPANY_NEXT_DUE = (
    "(SELECT MIN(t.due) FROM tasks t WHERE t.done_at = '' AND t.due != '' AND (t.company_id = co.id "
    "OR t.contact_id IN (SELECT id FROM contacts WHERE company_id = co.id)))"
)
COMPANY_SELECT = (
    f"SELECT co.*, {COMPANY_LAST_CONTACT} AS last_contact, {COMPANY_OPEN_TASKS} AS open_tasks, "
    f"{COMPANY_NEXT_DUE} AS next_due, r.name AS referrer_name, p.name AS parent_name "
    "FROM companies co LEFT JOIN referrers r ON r.id = co.referrer_id "
    "LEFT JOIN companies p ON p.id = co.parent_id"
)
CONTACT_SELECT = (
    "SELECT c.*, co.name AS company_name, co.status AS company_status, r.name AS referrer_name, "
    "(SELECT MAX(a.date) FROM activities a WHERE a.contact_id = c.id AND a.kind != 'System') AS last_contact, "
    "(SELECT COUNT(*) FROM tasks t WHERE t.contact_id = c.id AND t.done_at = '') AS open_tasks, "
    "(SELECT MIN(t.due) FROM tasks t WHERE t.contact_id = c.id AND t.done_at = '' AND t.due != '') AS next_due "
    "FROM contacts c LEFT JOIN companies co ON co.id = c.company_id "
    "LEFT JOIN referrers r ON r.id = c.referrer_id"
)
FREE_MAIL = {"gmx.at", "gmx.net", "gmx.de", "gmx.com", "aon.at", "gmail.com", "googlemail.com", "a1.net", "chello.at",
             "utanet.at", "hotmail.com", "hotmail.de", "hotmail.at", "yahoo.com", "yahoo.de", "yahoo.at", "outlook.com",
             "icloud.com", "me.com", "live.at", "kabsi.at", "web.de", "inode.at", "tele2.at", "drei.at", "speed.at"}


def core_name(name):
    """Firmenname ohne Rechtsform, Satzzeichen und Groß-/Kleinschreibung."""
    text = fold(name)
    text = re.sub(r"\bin\s+liqu(idation)?\.?", " ", text)
    text = re.sub(r"\b(gmbh\s*(&|und)\s*co\.?\s*kg|ges(ellschaft)?\.?\s*m\.?\s*b\.?\s*h\.?|g\.?\s*m\.?\s*b\.?\s*h\.?"
                  r"|gesmbh|mbh|gesellschaft mit beschränkter haftung|flexco|ag|kg|og|e\.?\s*u\.?)(?=\W|$)", " ", text)
    text = re.sub(r"(\S)(ges\.?\s*m\.?\s*b\.?\s*h\.?|gmbh)(?=\s|$)", r"\1", text)
    return re.sub(r"[^a-z0-9äöüß]", "", text)


def fn_key(value):
    return re.sub(r"[^0-9a-z]", "", fold(value).replace("fn", "", 1)) if value else ""


def phone_key(value):
    number = digits(value)
    if number.startswith("43"):
        number = "0" + number[2:]
    return number if len(number) >= 6 else ""


def mail_domain(value):
    domain = fold(value).rpartition("@")[2]
    return "" if not domain or domain in FREE_MAIL else domain


def name_similarity(a, b):
    if not a or not b:
        return 0
    if a == b:
        return 1
    if min(len(a), len(b)) >= 5 and (a in b or b in a):
        return 0.9
    return SequenceMatcher(None, a, b).ratio()


def person_name(row):
    return " ".join(p for p in (row["first_name"], row["last_name"]) if p)


class Api:
    def __init__(self, db, backups=None):
        self.db = db
        self.backups = backups
        self.restore_lock = threading.Lock()

    def export_database(self):
        """Vollständige Kopie der Datenbank zum Übertragen auf einen anderen Rechner."""
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "export.sqlite"
            self.db.backup_to(target)
            return target.read_bytes()

    def restore_database(self, data):
        """Ersetzt alle Daten durch eine Datensicherung. Der bisherige Stand wird vorher gesichert."""
        if not data.startswith(b"SQLite format 3\x00"):
            raise ApiError(415, "Das ist keine Datensicherung des CRM.")
        with tempfile.TemporaryDirectory() as folder:
            incoming = Path(folder) / "einlesen.sqlite"
            incoming.write_bytes(data)
            source = sqlite3.connect(incoming)
            try:
                try:
                    ok = source.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                    version = source.execute("PRAGMA user_version").fetchone()[0]
                    tables = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
                except sqlite3.DatabaseError:
                    raise ApiError(415, "Die Datei ist beschädigt oder keine Datensicherung des CRM.")
                if not ok:
                    raise ApiError(415, "Die Datei ist beschädigt.")
                if not {"contacts", "activities", "tasks"} <= tables:
                    raise ApiError(415, "Das ist keine Datensicherung des CRM.")
                if version > SCHEMA_VERSION:
                    raise ApiError(409, "Die Sicherung stammt aus einer neueren Version des CRM. Bitte zuerst die App aktualisieren.")
                with self.restore_lock:
                    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
                    self.db.backup_to(self.backups / f"crm-{stamp}-vor-einlesen.sqlite")
                    dest = self.db.connect()
                    try:
                        source.backup(dest)
                    finally:
                        dest.close()
                    self.db.migrate(self.backups)
            finally:
                source.close()
        conn = self.db.connect()
        try:
            counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("companies", "contacts")}
        finally:
            conn.close()
        return {"ok": True, **counts}

    def meta(self):
        return {
            "statuses": STATUSES, "pipeline": PIPELINE, "kinds": KINDS, "sources": SOURCES,
            "referralSource": REFERRAL_SOURCE, "consents": CONSENTS, "legalForms": LEGAL_FORMS,
            "grades": GRADES, "commissionStates": COMMISSION_STATES, "quietDays": QUIET_DAYS,
            "rating": RATING, "today": date.today().isoformat(), "version": VERSION, "platform": sys.platform,
        }

    # Prüfungen

    @staticmethod
    def require(conn, table, row_id, message):
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        if not row:
            raise ApiError(404, message)
        return row

    def referral_fields(self, conn, source, referrer_id):
        if source not in SOURCES and source != "":
            raise ApiError(400, "Quelle ungültig.")
        if source != REFERRAL_SOURCE:
            return None
        if referrer_id is not None:
            self.require(conn, "referrers", referrer_id, "Empfehler nicht gefunden.")
        return referrer_id

    def clean_person(self, conn, data, base=None):
        merged = dict(base) if base else {}
        for field in PERSON_FIELDS:
            if field in data:
                merged[field] = text_field(data[field], field)
            merged.setdefault(field, "")
        merged["status"] = merged["status"] or "Neu"
        merged["consent"] = merged["consent"] or "Offen"
        if not (merged["first_name"] or merged["last_name"]):
            raise ApiError(400, "Bitte einen Vor- oder Nachnamen angeben. Firmen legst du unter Firmen an.")
        if merged["status"] not in STATUSES:
            raise ApiError(400, "Status ungültig.")
        if merged["consent"] not in CONSENTS:
            raise ApiError(400, "Datenschutz-Angabe ungültig.")
        valid_email(merged["email"])
        merged["consent_date"] = valid_date(merged["consent_date"], "Datenschutz am")
        company_id = optional_id(data.get("company_id", (base or {}).get("company_id")), "Firma")
        if company_id is not None:
            self.require(conn, "companies", company_id, "Firma nicht gefunden.")
        merged["company_id"] = company_id
        merged["is_primary"] = 1 if data.get("is_primary", (base or {}).get("is_primary")) and company_id else 0
        referrer_id = optional_id(data.get("referrer_id", (base or {}).get("referrer_id")), "Empfehler")
        merged["referrer_id"] = self.referral_fields(conn, merged["source"], referrer_id)
        return merged

    def clean_company(self, conn, data, base=None, company_id=None):
        merged = dict(base) if base else {}
        for field in COMPANY_FIELDS:
            if field in data:
                merged[field] = text_field(data[field], field)
            merged.setdefault(field, "")
        if not merged["name"]:
            raise ApiError(400, "Bitte einen Firmennamen angeben.")
        merged["status"] = merged["status"] or "Neu"
        if merged["status"] not in STATUSES:
            raise ApiError(400, "Status ungültig.")
        merged["legal_form"] = merged["legal_form"] or detect_legal_form(merged["name"])
        if merged["legal_form"] and merged["legal_form"] not in LEGAL_FORMS:
            raise ApiError(400, "Rechtsform ungültig.")
        if merged["own_grade"] and merged["own_grade"] not in GRADES:
            raise ApiError(400, "Einstufung ungültig.")
        merged["website"] = valid_website(merged["website"])
        valid_email(merged["email"])
        parent_id = optional_id(data.get("parent_id", (base or {}).get("parent_id")), "Muttergesellschaft")
        if parent_id is not None:
            self.require(conn, "companies", parent_id, "Muttergesellschaft nicht gefunden.")
            cursor = parent_id
            seen = set()
            while cursor is not None and cursor not in seen:
                if cursor == company_id:
                    raise ApiError(400, "Eine Firma kann nicht unter sich selbst oder einer Tochter hängen.")
                seen.add(cursor)
                row = conn.execute("SELECT parent_id FROM companies WHERE id = ?", (cursor,)).fetchone()
                cursor = row["parent_id"] if row else None
        merged["parent_id"] = parent_id
        referrer_id = optional_id(data.get("referrer_id", (base or {}).get("referrer_id")), "Empfehler")
        merged["referrer_id"] = self.referral_fields(conn, merged["source"], referrer_id)
        return merged

    @staticmethod
    def financials_of(conn, company_id):
        return [dict(r) for r in conn.execute(
            "SELECT * FROM financials WHERE company_id = ? ORDER BY year DESC", (company_id,))]

    def company_row(self, conn, company_id):
        row = conn.execute(f"{COMPANY_SELECT} WHERE co.id = ?", (company_id,)).fetchone()
        if not row:
            raise ApiError(404, "Firma nicht gefunden.")
        company = dict(row)
        company["rating"] = rate_company(self.financials_of(conn, company_id), company["own_grade"])
        return company

    def contact_row(self, conn, contact_id):
        row = conn.execute(f"{CONTACT_SELECT} WHERE c.id = ?", (contact_id,)).fetchone()
        if not row:
            raise ApiError(404, "Kontakt nicht gefunden.")
        return dict(row)

    # Kontakte (Personen)

    def list_contacts(self, query):
        q = query.get("q", [""])[0].strip()
        status = query.get("status", [""])[0]
        sql, where, args = CONTACT_SELECT, [], []
        if q:
            pattern = like_pattern(q)
            where.append(
                "(fold(c.first_name || ' ' || c.last_name) LIKE ? ESCAPE '\\' "
                "OR fold(c.last_name || ' ' || c.first_name) LIKE ? ESCAPE '\\' "
                "OR fold(COALESCE(co.name, '')) LIKE ? ESCAPE '\\' OR fold(c.role) LIKE ? ESCAPE '\\' "
                "OR fold(c.email) LIKE ? ESCAPE '\\' OR fold(c.phone) LIKE ? ESCAPE '\\' "
                "OR fold(c.notes) LIKE ? ESCAPE '\\')")
            args += [pattern] * 7
        if status:
            where.append("COALESCE(co.status, c.status) = ?")
            args.append(status)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY fold(c.last_name), fold(c.first_name)"
        conn = self.db.connect()
        try:
            return [dict(r) for r in conn.execute(sql, args)]
        finally:
            conn.close()

    def get_contact(self, contact_id):
        conn = self.db.connect()
        try:
            contact = self.contact_row(conn, contact_id)
            contact["activities"] = [dict(r) for r in conn.execute(
                "SELECT * FROM activities WHERE contact_id = ? ORDER BY date DESC, id DESC", (contact_id,))]
            contact["tasks"] = [dict(r) for r in conn.execute(
                "SELECT * FROM tasks WHERE contact_id = ? ORDER BY done_at != '', due = '', due, id", (contact_id,))]
            return contact
        finally:
            conn.close()

    def write_contact(self, conn, c, contact_id=None):
        stamp = now()
        fields = PERSON_FIELDS + ["company_id", "is_primary", "referrer_id"]
        values = [c[f] for f in fields]
        if contact_id is None:
            cols = fields + ["created_at", "updated_at"]
            cur = conn.execute(
                f"INSERT INTO contacts ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                values + [stamp, stamp])
            contact_id = cur.lastrowid
        else:
            sets = ", ".join(f"{f} = ?" for f in fields)
            conn.execute(f"UPDATE contacts SET {sets}, updated_at = ? WHERE id = ?", values + [stamp, contact_id])
        if c["is_primary"]:
            conn.execute("UPDATE contacts SET is_primary = 0 WHERE company_id = ? AND id != ?",
                         (c["company_id"], contact_id))
        return contact_id

    def create_contact(self, data):
        conn = self.db.connect()
        try:
            c = self.clean_person(conn, data)
            with conn:
                contact_id = self.write_contact(conn, c)
            return self.contact_row(conn, contact_id)
        finally:
            conn.close()

    def update_contact(self, contact_id, data):
        conn = self.db.connect()
        try:
            base = dict(self.require(conn, "contacts", contact_id, "Kontakt nicht gefunden."))
            c = self.clean_person(conn, data, base)
            with conn:
                self.write_contact(conn, c, contact_id)
                if base["status"] != c["status"] and not c["company_id"]:
                    self.log_status(conn, "contact_id", contact_id, base["status"], c["status"])
            return self.contact_row(conn, contact_id)
        finally:
            conn.close()

    @staticmethod
    def log_status(conn, column, row_id, old, new):
        conn.execute(
            f"INSERT INTO activities ({column}, kind, date, text, created_at) VALUES (?, 'System', ?, ?, ?)",
            (row_id, date.today().isoformat(), f"Status: {old} → {new}", now()))

    def delete_row(self, table, row_id, message="Eintrag nicht gefunden."):
        conn = self.db.connect()
        try:
            with conn:
                if conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,)).rowcount == 0:
                    raise ApiError(404, message)
            return {"ok": True}
        finally:
            conn.close()

    # Firmen

    def list_companies(self):
        conn = self.db.connect()
        try:
            companies = [dict(r) for r in conn.execute(f"{COMPANY_SELECT} ORDER BY fold(co.name)")]
            fin = {}
            for row in conn.execute("SELECT * FROM financials ORDER BY year DESC"):
                fin.setdefault(row["company_id"], []).append(dict(row))
            for company in companies:
                company["rating"] = rate_company(fin.get(company["id"], []), company["own_grade"])
            return companies
        finally:
            conn.close()

    def tree(self):
        companies = self.list_companies()
        conn = self.db.connect()
        try:
            people = [dict(r) for r in conn.execute(
                f"{CONTACT_SELECT} ORDER BY c.is_primary DESC, fold(c.last_name), fold(c.first_name)")]
        finally:
            conn.close()
        by_company = {}
        for person in people:
            by_company.setdefault(person["company_id"], []).append(person)
        for company in companies:
            company["people"] = by_company.get(company["id"], [])
        return {"companies": companies, "private": by_company.get(None, [])}

    def get_company(self, company_id):
        conn = self.db.connect()
        try:
            company = self.company_row(conn, company_id)
            company["financials"] = self.financials_of(conn, company_id)
            company["people"] = [dict(r) for r in conn.execute(
                f"{CONTACT_SELECT} WHERE c.company_id = ? "
                "ORDER BY c.is_primary DESC, fold(c.last_name), fold(c.first_name)", (company_id,))]
            company["children"] = [dict(r) for r in conn.execute(
                "SELECT id, name, status FROM companies WHERE parent_id = ? ORDER BY fold(name)", (company_id,))]
            person_label = "c.first_name || ' ' || c.last_name"
            company["activities"] = [dict(r) for r in conn.execute(
                f"SELECT a.*, TRIM({person_label}) AS person FROM activities a "
                "LEFT JOIN contacts c ON c.id = a.contact_id "
                "WHERE a.company_id = ? OR c.company_id = ? ORDER BY a.date DESC, a.id DESC",
                (company_id, company_id))]
            company["tasks"] = [dict(r) for r in conn.execute(
                f"SELECT t.*, TRIM({person_label}) AS person FROM tasks t "
                "LEFT JOIN contacts c ON c.id = t.contact_id "
                "WHERE t.company_id = ? OR c.company_id = ? "
                "ORDER BY t.done_at != '', t.due = '', t.due, t.id", (company_id, company_id))]
            return company
        finally:
            conn.close()

    def create_company(self, data):
        conn = self.db.connect()
        try:
            c = self.clean_company(conn, data)
            stamp = now()
            fields = COMPANY_FIELDS + ["parent_id", "referrer_id"]
            cols = fields + ["created_at", "updated_at"]
            with conn:
                cur = conn.execute(
                    f"INSERT INTO companies ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [c[f] for f in fields] + [stamp, stamp])
            return self.company_row(conn, cur.lastrowid)
        finally:
            conn.close()

    def update_company(self, company_id, data):
        conn = self.db.connect()
        try:
            base = dict(self.require(conn, "companies", company_id, "Firma nicht gefunden."))
            c = self.clean_company(conn, data, base, company_id)
            fields = COMPANY_FIELDS + ["parent_id", "referrer_id"]
            sets = ", ".join(f"{f} = ?" for f in fields)
            with conn:
                conn.execute(f"UPDATE companies SET {sets}, updated_at = ? WHERE id = ?",
                             [c[f] for f in fields] + [now(), company_id])
                if base["status"] != c["status"]:
                    self.log_status(conn, "company_id", company_id, base["status"], c["status"])
            return self.company_row(conn, company_id)
        finally:
            conn.close()

    def delete_company(self, company_id):
        conn = self.db.connect()
        try:
            company = self.require(conn, "companies", company_id, "Firma nicht gefunden.")
            with conn:
                # Ansprechpartner bleiben als Privatpersonen erhalten und übernehmen den Status der Firma.
                conn.execute("UPDATE contacts SET status = ?, source = ?, referrer_id = ?, is_primary = 0 "
                             "WHERE company_id = ?",
                             (company["status"], company["source"], company["referrer_id"], company_id))
                conn.execute("DELETE FROM companies WHERE id = ?", (company_id,))
            return {"ok": True}
        finally:
            conn.close()

    # Bilanzen

    def clean_financial(self, data):
        year = data.get("year")
        try:
            year = int(year)
        except (TypeError, ValueError):
            raise ApiError(400, "Bitte ein Bilanzjahr angeben.")
        if not 1990 <= year <= date.today().year + 1:
            raise ApiError(400, "Bilanzjahr ungültig.")
        labels = {
            "total_assets": "Bilanzsumme", "equity": "Eigenkapital", "liquid": "Liquide Mittel",
            "securities": "Wertpapiere", "liabilities": "Verbindlichkeiten", "retained": "Bilanzgewinn",
        }
        clean = {"year": year, "origin": body_text(data, "origin", "Herkunft", required=False)}
        for field in FINANCIAL_NUMBERS:
            clean[field] = whole_euro(data.get(field), labels[field])
        return clean

    def add_financial(self, company_id, data):
        clean = self.clean_financial(data)
        conn = self.db.connect()
        try:
            self.require(conn, "companies", company_id, "Firma nicht gefunden.")
            fields = ["year", *FINANCIAL_NUMBERS, "origin"]
            try:
                with conn:
                    conn.execute(
                        f"INSERT INTO financials (company_id, {', '.join(fields)}, created_at) "
                        f"VALUES (?, {', '.join('?' * len(fields))}, ?)",
                        [company_id] + [clean[f] for f in fields] + [now()])
            except sqlite3.IntegrityError:
                raise ApiError(409, f"Für {clean['year']} gibt es schon eine Bilanz. Bearbeite bitte diese.")
            return {"ok": True}
        finally:
            conn.close()

    def update_financial(self, financial_id, data):
        clean = self.clean_financial(data)
        conn = self.db.connect()
        try:
            self.require(conn, "financials", financial_id, "Bilanz nicht gefunden.")
            fields = ["year", *FINANCIAL_NUMBERS, "origin"]
            sets = ", ".join(f"{f} = ?" for f in fields)
            try:
                with conn:
                    conn.execute(f"UPDATE financials SET {sets} WHERE id = ?",
                                 [clean[f] for f in fields] + [financial_id])
            except sqlite3.IntegrityError:
                raise ApiError(409, f"Für {clean['year']} gibt es schon eine Bilanz.")
            return {"ok": True}
        finally:
            conn.close()

    # Verlauf und Aufgaben

    def add_activity(self, column, owner_id, data):
        kind = body_text(data, "kind", "die Art")
        if kind not in KINDS:
            raise ApiError(400, "Art ungültig.")
        text = body_text(data, "text", "einen Text")
        when = valid_date(body_text(data, "date", "ein Datum"), "Datum")
        table = "contacts" if column == "contact_id" else "companies"
        conn = self.db.connect()
        try:
            self.require(conn, table, owner_id, "Eintrag nicht gefunden.")
            with conn:
                conn.execute(
                    f"INSERT INTO activities ({column}, kind, date, text, created_at) VALUES (?, ?, ?, ?, ?)",
                    (owner_id, kind, when, text, now()))
            return {"ok": True}
        finally:
            conn.close()

    def add_task(self, column, owner_id, data):
        title = body_text(data, "title", "eine Aufgabe")
        due = valid_date(body_text(data, "due", "ein Datum", required=False), "Fällig am")
        table = "contacts" if column == "contact_id" else "companies"
        conn = self.db.connect()
        try:
            self.require(conn, table, owner_id, "Eintrag nicht gefunden.")
            with conn:
                conn.execute(f"INSERT INTO tasks ({column}, title, due, created_at) VALUES (?, ?, ?, ?)",
                             (owner_id, title, due, now()))
            return {"ok": True}
        finally:
            conn.close()

    def update_task(self, task_id, data):
        done = data.get("done")
        if not isinstance(done, bool):
            raise ApiError(400, "Angabe ungültig.")
        conn = self.db.connect()
        try:
            with conn:
                cur = conn.execute("UPDATE tasks SET done_at = ? WHERE id = ?", (now() if done else "", task_id))
                if cur.rowcount == 0:
                    raise ApiError(404, "Aufgabe nicht gefunden.")
            return {"ok": True}
        finally:
            conn.close()

    # Empfehler und Provisionen

    def clean_referrer(self, data, base=None):
        merged = dict(base) if base else {}
        for field in REFERRER_FIELDS:
            if field in data:
                merged[field] = text_field(data[field], field)
            merged.setdefault(field, "")
        if not merged["name"]:
            raise ApiError(400, "Bitte einen Namen angeben.")
        valid_email(merged["email"])
        merged["agreement_date"] = valid_date(merged["agreement_date"], "Vereinbart am")
        merged["commission_agreed"] = 1 if data.get("commission_agreed", (base or {}).get("commission_agreed")) else 0
        return merged

    def list_referrers(self):
        conn = self.db.connect()
        try:
            return [dict(r) for r in conn.execute(
                "SELECT r.*, "
                "(SELECT COUNT(*) FROM companies WHERE referrer_id = r.id) + "
                "(SELECT COUNT(*) FROM contacts WHERE referrer_id = r.id) AS referred, "
                "COALESCE((SELECT SUM(amount_cents) FROM commissions "
                "WHERE referrer_id = r.id AND status != 'Bezahlt'), 0) AS open_cents, "
                "COALESCE((SELECT SUM(amount_cents) FROM commissions "
                "WHERE referrer_id = r.id AND status = 'Bezahlt'), 0) AS paid_cents "
                "FROM referrers r ORDER BY fold(r.name)")]
        finally:
            conn.close()

    def get_referrer(self, referrer_id):
        conn = self.db.connect()
        try:
            referrer = dict(self.require(conn, "referrers", referrer_id, "Empfehler nicht gefunden."))
            referrer["companies"] = [dict(r) for r in conn.execute(
                "SELECT id, name, status FROM companies WHERE referrer_id = ? ORDER BY fold(name)", (referrer_id,))]
            referrer["people"] = [dict(r) for r in conn.execute(
                "SELECT id, first_name, last_name, status FROM contacts WHERE referrer_id = ? "
                "ORDER BY fold(last_name)", (referrer_id,))]
            referrer["commissions"] = [dict(r) for r in conn.execute(
                "SELECT * FROM commissions WHERE referrer_id = ? ORDER BY date DESC, id DESC", (referrer_id,))]
            return referrer
        finally:
            conn.close()

    def create_referrer(self, data):
        r = self.clean_referrer(data)
        fields = REFERRER_FIELDS + ["commission_agreed"]
        cols = fields + ["created_at", "updated_at"]
        stamp = now()
        conn = self.db.connect()
        try:
            with conn:
                cur = conn.execute(
                    f"INSERT INTO referrers ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [r[f] for f in fields] + [stamp, stamp])
            return dict(conn.execute("SELECT * FROM referrers WHERE id = ?", (cur.lastrowid,)).fetchone())
        finally:
            conn.close()

    def update_referrer(self, referrer_id, data):
        conn = self.db.connect()
        try:
            base = dict(self.require(conn, "referrers", referrer_id, "Empfehler nicht gefunden."))
            r = self.clean_referrer(data, base)
            fields = REFERRER_FIELDS + ["commission_agreed"]
            sets = ", ".join(f"{f} = ?" for f in fields)
            with conn:
                conn.execute(f"UPDATE referrers SET {sets}, updated_at = ? WHERE id = ?",
                             [r[f] for f in fields] + [now(), referrer_id])
            return {"ok": True}
        finally:
            conn.close()

    def delete_referrer(self, referrer_id):
        conn = self.db.connect()
        try:
            self.require(conn, "referrers", referrer_id, "Empfehler nicht gefunden.")
            if conn.execute("SELECT 1 FROM commissions WHERE referrer_id = ?", (referrer_id,)).fetchone():
                raise ApiError(409, "Es gibt noch Provisionen zu diesem Empfehler. Bitte zuerst diese löschen.")
            with conn:
                conn.execute("DELETE FROM referrers WHERE id = ?", (referrer_id,))
            return {"ok": True}
        finally:
            conn.close()

    def add_commission(self, referrer_id, data):
        cents = amount_cents(data.get("amount"))
        when = valid_date(body_text(data, "date", "ein Datum"), "Datum")
        status = body_text(data, "status", "einen Stand", required=False) or "Offen"
        if status not in COMMISSION_STATES:
            raise ApiError(400, "Stand ungültig.")
        note = body_text(data, "note", "Notiz", required=False)
        customer = body_text(data, "customer", "Kunde", required=False)
        company_id, contact_id, label = None, None, ""
        conn = self.db.connect()
        try:
            self.require(conn, "referrers", referrer_id, "Empfehler nicht gefunden.")
            match = re.fullmatch(r"(company|contact):(\d+)", customer)
            if customer and not match:
                raise ApiError(400, "Kunde ungültig.")
            if match and match[1] == "company":
                row = self.require(conn, "companies", int(match[2]), "Firma nicht gefunden.")
                company_id, label = row["id"], row["name"]
            elif match:
                row = self.require(conn, "contacts", int(match[2]), "Kontakt nicht gefunden.")
                contact_id, label = row["id"], person_name(row)
            with conn:
                conn.execute(
                    "INSERT INTO commissions (referrer_id, company_id, contact_id, customer_label, date, "
                    "amount_cents, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (referrer_id, company_id, contact_id, label, when, cents, status, note, now()))
            return {"ok": True}
        finally:
            conn.close()

    def update_commission(self, commission_id, data):
        status = data.get("status")
        if status not in COMMISSION_STATES:
            raise ApiError(400, "Stand ungültig.")
        conn = self.db.connect()
        try:
            with conn:
                cur = conn.execute("UPDATE commissions SET status = ? WHERE id = ?", (status, commission_id))
                if cur.rowcount == 0:
                    raise ApiError(404, "Provision nicht gefunden.")
            return {"ok": True}
        finally:
            conn.close()

    # Suche über alles

    def search(self, query):
        words = fold(query.get("q", [""])[0]).split()
        if not words or sum(len(w) for w in words) < 2:
            return {"companies": [], "people": [], "referrers": []}
        raw = query.get("q", [""])[0]
        # Reine Nummer: Schreibweise egal, also nur die Ziffern vergleichen.
        number = re.sub(r"\D", "", raw) if re.fullmatch(r"[\d\s/+()-]+", raw.strip()) else ""
        number = number if len(number) >= 3 else ""
        if number.startswith("43"):
            number = "0" + number[2:]

        def run(conn, sql, text_columns, phone_columns):
            if number:
                condition = " OR ".join(f"digits({c}) LIKE ?" for c in phone_columns)
                args = [f"%{number}%"] * len(phone_columns)
            else:
                haystack = " || ' ' || ".join(f"COALESCE({c}, '')" for c in text_columns)
                condition = " AND ".join(f"fold({haystack}) LIKE ? ESCAPE '\\'" for _ in words)
                args = [like_pattern(w) for w in words]
            return [dict(r) for r in conn.execute(f"{sql} WHERE {condition}", args)]

        def ranked(rows, name):
            # Treffer im Namen zuerst, danach alphabetisch.
            def score(row):
                label = fold(name(row))
                return (0 if label.startswith(words[0]) else 1 if all(w in label for w in words) else 2, label)
            return {"total": len(rows), "items": sorted(rows, key=score)[:SEARCH_LIMIT]}

        conn = self.db.connect()
        try:
            companies = run(
                conn, "SELECT co.id, co.name, co.status, co.phone, co.email, co.address, co.industry FROM companies co",
                ["co.name", "co.industry", "co.register_no", "co.website", "co.phone", "co.phone2", "co.email",
                 "co.address", "co.notes"], ["co.phone", "co.phone2"])
            people = run(
                conn, "SELECT c.id, c.first_name, c.last_name, c.role, c.phone, c.email, c.status, c.company_id, "
                      "co.name AS company_name, co.status AS company_status "
                      "FROM contacts c LEFT JOIN companies co ON co.id = c.company_id",
                ["c.first_name", "c.last_name", "co.name", "c.role", "c.email", "c.phone", "c.address", "c.notes"],
                ["c.phone"])
            referrers = run(conn, "SELECT r.id, r.name, r.phone, r.email FROM referrers r",
                            ["r.name", "r.email", "r.phone", "r.notes"], ["r.phone"])
        finally:
            conn.close()
        return {
            "companies": ranked(companies, lambda r: r["name"]),
            "people": ranked(people, person_name),
            "referrers": ranked(referrers, lambda r: r["name"]),
        }

    # Dubletten: ähnliche Firmen oder Personen schon beim Anlegen finden

    def similar(self, query):
        get = lambda key: query.get(key, [""])[0].strip()
        kind = get("kind")
        exclude = optional_id(get("exclude"), "Eintrag")
        matches = []
        conn = self.db.connect()
        try:
            if kind == "company":
                name, fn, email = core_name(get("name")), fn_key(get("register_no")), fold(get("email"))
                phones = {p for p in (phone_key(get("phone")), phone_key(get("phone2"))) if p}
                domain = mail_domain(email)
                for row in conn.execute("SELECT id, name, register_no, phone, phone2, email, address, status FROM companies"):
                    if row["id"] == exclude:
                        continue
                    strong, weak = [], []
                    score = name_similarity(name, core_name(row["name"])) if len(name) >= 3 else 0
                    if score == 1:
                        strong.append("gleicher Name")
                    elif score >= 0.85:
                        weak.append("ähnlicher Name")
                    if fn and fn == fn_key(row["register_no"]):
                        strong.append("gleiche Firmenbuchnummer")
                    if email and email == fold(row["email"]):
                        strong.append("gleiche E-Mail")
                    elif domain and domain == mail_domain(row["email"]):
                        weak.append("gleiche Mail-Domain")
                    if phones & {p for p in (phone_key(row["phone"]), phone_key(row["phone2"])) if p}:
                        weak.append("gleiche Telefonnummer")
                    if strong or weak:
                        matches.append({"id": row["id"], "label": row["name"], "sub": row["address"], "status": row["status"],
                                        "strong": bool(strong), "reasons": strong + weak, "score": score})
            elif kind == "contact":
                first, last = fold(get("first_name")), fold(get("last_name"))
                full = re.sub(r"[^a-zäöüß]", "", first + last)
                email, phone = fold(get("email")), phone_key(get("phone"))
                for row in conn.execute(
                        "SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.role, co.name AS company_name "
                        "FROM contacts c LEFT JOIN companies co ON co.id = c.company_id"):
                    if row["id"] == exclude:
                        continue
                    strong, weak = [], []
                    f2, l2 = fold(row["first_name"]), fold(row["last_name"])
                    same = {re.sub(r"[^a-zäöüß]", "", f2 + l2), re.sub(r"[^a-zäöüß]", "", l2 + f2)}
                    if last and full and full in same:
                        strong.append("gleicher Name")
                    elif last and l2 and (name_similarity(full, re.sub(r"[^a-zäöüß]", "", f2 + l2)) >= 0.88
                                          or (last == l2 and first[:1] and first[:1] == f2[:1])):
                        weak.append("ähnlicher Name")
                    if email and email == fold(row["email"]):
                        strong.append("gleiche E-Mail")
                    if phone and phone == phone_key(row["phone"]):
                        weak.append("gleiche Telefonnummer")
                    if strong or weak:
                        sub = " · ".join(x for x in (row["company_name"] or "Privatperson", row["role"]) if x)
                        matches.append({"id": row["id"], "label": person_name(row), "sub": sub, "status": "",
                                        "strong": bool(strong), "reasons": strong + weak, "score": len(strong)})
            else:
                raise ApiError(400, "Art ungültig.")
        finally:
            conn.close()
        matches.sort(key=lambda m: (not m["strong"], -len(m["reasons"]), -m["score"], fold(m["label"])))
        return matches[:8]

    # Übersicht und Pipeline

    def pipeline(self):
        items = []
        for company in self.list_companies():
            items.append({
                "kind": "company", "id": company["id"], "name": company["name"], "status": company["status"],
                "sub": company["industry"], "next_due": company["next_due"], "grade": company["rating"]["grade"],
            })
        conn = self.db.connect()
        try:
            for row in conn.execute(f"{CONTACT_SELECT} WHERE c.company_id IS NULL"):
                items.append({
                    "kind": "contact", "id": row["id"], "name": person_name(row), "status": row["status"],
                    "sub": "Privatperson", "next_due": row["next_due"], "grade": None,
                })
        finally:
            conn.close()
        return sorted(items, key=lambda i: fold(i["name"]))

    def overview(self):
        today = date.today().isoformat()
        quiet_before = (date.today() - timedelta(days=QUIET_DAYS)).isoformat()
        conn = self.db.connect()
        try:
            task_sql = (
                "SELECT t.id, t.title, t.due, t.contact_id, t.company_id, p.first_name, p.last_name, "
                "o.name AS company_name FROM tasks t LEFT JOIN contacts p ON p.id = t.contact_id "
                "LEFT JOIN companies o ON o.id = t.company_id WHERE t.done_at = '' "
            )
            overdue = [dict(r) for r in conn.execute(task_sql + "AND t.due != '' AND t.due < ? ORDER BY t.due", (today,))]
            due_today = [dict(r) for r in conn.execute(task_sql + "AND t.due = ? ORDER BY t.id", (today,))]
            upcoming = [dict(r) for r in conn.execute(task_sql + "AND t.due > ? ORDER BY t.due LIMIT 8", (today,))]
            counts = {s: 0 for s in STATUSES}
            for query in ("SELECT status, COUNT(*) AS n FROM companies GROUP BY status",
                          "SELECT status, COUNT(*) AS n FROM contacts WHERE company_id IS NULL GROUP BY status"):
                for row in conn.execute(query):
                    counts[row["status"]] = counts.get(row["status"], 0) + row["n"]
            quiet = [dict(r) for r in conn.execute(
                f"SELECT 'company' AS kind, co.id, co.name, {COMPANY_LAST_CONTACT} AS last_contact, co.created_at "
                "FROM companies co WHERE co.status = 'Kunde' UNION ALL "
                "SELECT 'contact', c.id, TRIM(c.first_name || ' ' || c.last_name), "
                "(SELECT MAX(a.date) FROM activities a WHERE a.contact_id = c.id AND a.kind != 'System'), c.created_at "
                "FROM contacts c WHERE c.status = 'Kunde' AND c.company_id IS NULL")
                if (r["last_contact"] or r["created_at"][:10]) < quiet_before]
            quiet.sort(key=lambda r: r["last_contact"] or r["created_at"][:10])
            consent_open = conn.execute(
                "SELECT COUNT(*) FROM contacts WHERE consent IN ('Offen', 'Widerrufen')").fetchone()[0]
            recent = [dict(r) for r in conn.execute(
                "SELECT a.id, a.kind, a.date, a.text, a.contact_id, a.company_id, p.first_name, p.last_name, "
                "o.name AS company_name FROM activities a LEFT JOIN contacts p ON p.id = a.contact_id "
                "LEFT JOIN companies o ON o.id = a.company_id "
                "WHERE a.kind != 'System' ORDER BY a.date DESC, a.id DESC LIMIT 6")]
            return {
                "overdue": overdue, "today": due_today, "upcoming": upcoming, "counts": counts,
                "quiet": quiet[:10], "consentOpen": consent_open, "recent": recent,
            }
        finally:
            conn.close()

    # Exporte

    def export_contacts(self):
        headers = {
            "first_name": "Vorname", "last_name": "Nachname", "company_name": "Firma", "role": "Funktion",
            "email": "E-Mail", "phone": "Telefon", "address": "Anschrift", "source": "Quelle",
            "referrer_name": "Empfehler", "status_shown": "Status", "consent": "Datenschutz",
            "consent_date": "Datenschutz am", "notes": "Notizen", "last_contact": "Letzter Kontakt",
        }
        conn = self.db.connect()
        try:
            rows = [dict(r) for r in conn.execute(f"{CONTACT_SELECT} ORDER BY fold(c.last_name), fold(c.first_name)")]
        finally:
            conn.close()
        for row in rows:
            row["status_shown"] = row["company_status"] or row["status"]
        return self.to_csv(headers, rows)

    def export_companies(self):
        headers = {
            "name": "Firma", "legal_form": "Rechtsform", "register_no": "Firmenbuchnummer", "industry": "Branche",
            "website": "Webseite", "phone": "Telefon", "phone2": "Telefon 2", "email": "E-Mail",
            "address": "Anschrift", "parent_name": "Muttergesellschaft", "status": "Status",
            "source": "Quelle", "referrer_name": "Empfehler", "grade": "Einstufung", "year": "Bilanzjahr",
            "equity_ratio": "Eigenkapitalquote %", "investable": "Anlagefähige Mittel", "notes": "Notizen",
        }
        rows = self.list_companies()
        for row in rows:
            rating = row["rating"]
            ratio = rating["equity_ratio"]
            row.update(grade=rating["grade"], year=rating["year"], investable=rating["investable"],
                       equity_ratio=None if ratio is None else str(ratio).replace(".", ","))
        return self.to_csv(headers, rows)

    @staticmethod
    def to_csv(headers, rows):
        out = io.StringIO()
        writer = csv.writer(out, delimiter=";")
        writer.writerow(headers.values())
        for row in rows:
            writer.writerow(csv_safe(f, row.get(f)) for f in headers)
        return "﻿" + out.getvalue()


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2",
}


def make_handler(api, port):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    allowed_origins = {f"http://{h}" for h in allowed_hosts}

    routes = [
        ("GET", r"/api/meta", lambda m, q, b: api.meta()),
        ("GET", r"/api/overview", lambda m, q, b: api.overview()),
        ("GET", r"/api/pipeline", lambda m, q, b: api.pipeline()),
        ("GET", r"/api/tree", lambda m, q, b: api.tree()),
        ("GET", r"/api/search", lambda m, q, b: api.search(q)),
        ("GET", r"/api/similar", lambda m, q, b: api.similar(q)),
        ("GET", r"/api/contacts", lambda m, q, b: api.list_contacts(q)),
        ("POST", r"/api/contacts", lambda m, q, b: api.create_contact(b)),
        ("GET", r"/api/contacts/(\d+)", lambda m, q, b: api.get_contact(int(m[1]))),
        ("PUT", r"/api/contacts/(\d+)", lambda m, q, b: api.update_contact(int(m[1]), b)),
        ("DELETE", r"/api/contacts/(\d+)", lambda m, q, b: api.delete_row("contacts", int(m[1]), "Kontakt nicht gefunden.")),
        ("POST", r"/api/contacts/(\d+)/activities", lambda m, q, b: api.add_activity("contact_id", int(m[1]), b)),
        ("POST", r"/api/contacts/(\d+)/tasks", lambda m, q, b: api.add_task("contact_id", int(m[1]), b)),
        ("GET", r"/api/companies", lambda m, q, b: api.list_companies()),
        ("POST", r"/api/companies", lambda m, q, b: api.create_company(b)),
        ("GET", r"/api/companies/(\d+)", lambda m, q, b: api.get_company(int(m[1]))),
        ("PUT", r"/api/companies/(\d+)", lambda m, q, b: api.update_company(int(m[1]), b)),
        ("DELETE", r"/api/companies/(\d+)", lambda m, q, b: api.delete_company(int(m[1]))),
        ("POST", r"/api/companies/(\d+)/activities", lambda m, q, b: api.add_activity("company_id", int(m[1]), b)),
        ("POST", r"/api/companies/(\d+)/tasks", lambda m, q, b: api.add_task("company_id", int(m[1]), b)),
        ("POST", r"/api/companies/(\d+)/financials", lambda m, q, b: api.add_financial(int(m[1]), b)),
        ("PUT", r"/api/financials/(\d+)", lambda m, q, b: api.update_financial(int(m[1]), b)),
        ("DELETE", r"/api/financials/(\d+)", lambda m, q, b: api.delete_row("financials", int(m[1]))),
        ("DELETE", r"/api/activities/(\d+)", lambda m, q, b: api.delete_row("activities", int(m[1]))),
        ("PUT", r"/api/tasks/(\d+)", lambda m, q, b: api.update_task(int(m[1]), b)),
        ("DELETE", r"/api/tasks/(\d+)", lambda m, q, b: api.delete_row("tasks", int(m[1]))),
        ("GET", r"/api/referrers", lambda m, q, b: api.list_referrers()),
        ("POST", r"/api/referrers", lambda m, q, b: api.create_referrer(b)),
        ("GET", r"/api/referrers/(\d+)", lambda m, q, b: api.get_referrer(int(m[1]))),
        ("PUT", r"/api/referrers/(\d+)", lambda m, q, b: api.update_referrer(int(m[1]), b)),
        ("DELETE", r"/api/referrers/(\d+)", lambda m, q, b: api.delete_referrer(int(m[1]))),
        ("POST", r"/api/referrers/(\d+)/commissions", lambda m, q, b: api.add_commission(int(m[1]), b)),
        ("PUT", r"/api/commissions/(\d+)", lambda m, q, b: api.update_commission(int(m[1]), b)),
        ("DELETE", r"/api/commissions/(\d+)", lambda m, q, b: api.delete_row("commissions", int(m[1]))),
    ]
    exports = {
        "/api/export.csv": ("kontakte", api.export_contacts),
        "/api/export-firmen.csv": ("firmen", api.export_companies),
    }

    class Handler(BaseHTTPRequestHandler):
        server_version = "MeerkoetterCRM"
        sys_version = ""

        def log_message(self, fmt, *args):
            # Pfade und Suchbegriffe können Personendaten enthalten, daher nur Fehler protokollieren.
            pass

        def log_error(self, fmt, *args):
            print("Fehler:", fmt % args, file=sys.stderr, flush=True)

        def send_bytes(self, status, content, content_type, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def send_json(self, status, payload):
            self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def request_allowed(self):
            # Schützt vor Zugriffen fremder Webseiten auf den lokalen Server.
            if self.headers.get("Host") not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            if origin is not None and origin not in allowed_origins:
                return False
            return True

        def read_json(self):
            if self.headers.get_content_type() != "application/json":
                raise ApiError(415, "Nur JSON wird angenommen.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Anfrage ungültig.")
            if length > MAX_BODY:
                raise ApiError(413, "Anfrage zu groß.")
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ApiError(400, "Anfrage ungültig.")
            if not isinstance(data, dict):
                raise ApiError(400, "Anfrage ungültig.")
            return data

        def recognize_text(self):
            """Liest den Text eines Bildes. Das Bild liegt nur kurz in einem temporären Ordner."""
            if sys.platform not in ("darwin", "win32"):
                raise ApiError(501, "Die Texterkennung gibt es nur auf Mac und Windows.")
            suffix = IMAGE_TYPES.get(self.headers.get_content_type())
            if not suffix:
                raise ApiError(415, "Bitte ein Bild (PNG oder JPG) einfügen.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Anfrage ungültig.")
            if not 0 < length <= MAX_IMAGE:
                raise ApiError(413, "Das Bild ist zu groß.")
            data = self.rfile.read(length)
            with tempfile.TemporaryDirectory() as folder:
                image = Path(folder) / f"bild{suffix}"
                image.write_bytes(data)
                if sys.platform == "win32":
                    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                               "-File", str(OCR_SCRIPT_WINDOWS), str(image)]
                else:
                    command = ["osascript", "-l", "JavaScript", str(OCR_SCRIPT), str(image)]
                try:
                    done = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                          errors="replace", timeout=120, creationflags=NO_WINDOW)
                except subprocess.TimeoutExpired:
                    raise ApiError(504, "Die Texterkennung hat zu lange gebraucht.")
            if done.returncode != 0:
                self.log_error("Texterkennung: %s", done.stderr.strip()[:300])
                raise ApiError(500, "Die Texterkennung hat nicht funktioniert.")
            try:
                lines = json.loads(done.stdout)
            except json.JSONDecodeError:
                raise ApiError(500, "Die Texterkennung hat nicht funktioniert.")
            return {"lines": lines}

        def read_pdf_text(self):
            """Liest den Text einer PDF. Die Datei liegt nur kurz in einem temporären Ordner."""
            if self.headers.get_content_type() != "application/pdf":
                raise ApiError(415, "Bitte eine PDF-Datei verwenden.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Anfrage ungültig.")
            if not 0 < length <= MAX_IMAGE:
                raise ApiError(413, "Die PDF ist zu groß.")
            data = self.rfile.read(length)
            if not data.startswith(b"%PDF"):
                raise ApiError(415, "Das ist keine PDF-Datei.")
            if sys.platform != "darwin":
                return pdf_text_portable(data)
            with tempfile.TemporaryDirectory() as folder:
                pdf = Path(folder) / "abschluss.pdf"
                pdf.write_bytes(data)
                try:
                    done = subprocess.run(["osascript", "-l", "JavaScript", str(PDF_SCRIPT), str(pdf)],
                                          capture_output=True, text=True, timeout=120)
                except subprocess.TimeoutExpired:
                    raise ApiError(504, "Das Auslesen der PDF hat zu lange gebraucht.")
            if done.returncode != 0:
                self.log_error("PDF lesen: %s", done.stderr.strip()[:300])
                raise ApiError(500, "Die PDF ließ sich nicht lesen.")
            try:
                return json.loads(done.stdout)
            except json.JSONDecodeError:
                raise ApiError(500, "Die PDF ließ sich nicht lesen.")

        def dispatch(self):
            if not self.request_allowed():
                self.send_json(403, {"error": "Zugriff nicht erlaubt."})
                return
            parsed = urlparse(self.path)
            path = parsed.path
            try:
                if path == "/api/ocr" and self.command == "POST":
                    self.send_json(200, self.recognize_text())
                    return
                if path == "/api/pdf" and self.command == "POST":
                    self.send_json(200, self.read_pdf_text())
                    return
                if path == "/api/backup" and self.command == "GET":
                    name = f"Meerkoetter-CRM-Daten-{datetime.now().strftime('%Y-%m-%d-%H%M')}.crmdaten"
                    self.send_bytes(200, api.export_database(), "application/octet-stream",
                                    {"Content-Disposition": f'attachment; filename="{name}"'})
                    return
                if path == "/api/restore" and self.command == "POST":
                    if self.headers.get_content_type() != "application/octet-stream":
                        raise ApiError(415, "Bitte eine Datensicherung des CRM wählen.")
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                    except ValueError:
                        raise ApiError(400, "Anfrage ungültig.")
                    if not 0 < length <= MAX_DATABASE:
                        raise ApiError(413, "Die Datei ist zu groß.")
                    self.send_json(200, api.restore_database(self.rfile.read(length)))
                    return
                if path in exports and self.command == "GET":
                    label, build = exports[path]
                    name = f"meerkoetter-{label}-{date.today().isoformat()}.csv"
                    self.send_bytes(200, build().encode("utf-8"), "text/csv; charset=utf-8",
                                    {"Content-Disposition": f'attachment; filename="{name}"'})
                    return
                if path.startswith("/api/"):
                    matched_path = False
                    for method, pattern, fn in routes:
                        match = re.fullmatch(pattern, path)
                        if not match:
                            continue
                        matched_path = True
                        if method == self.command:
                            body = self.read_json() if method in ("POST", "PUT") else {}
                            self.send_json(200, fn(match, parse_qs(parsed.query), body))
                            return
                    raise ApiError(405 if matched_path else 404, "Nicht gefunden.")
                if self.command in ("GET", "HEAD"):
                    self.serve_static(path)
                    return
                raise ApiError(405, "Nicht erlaubt.")
            except ApiError as err:
                self.send_json(err.status, {"error": err.message})
            except sqlite3.Error as err:
                self.log_error("Datenbankfehler: %s", err)
                self.send_json(500, {"error": "Datenbankfehler."})

        def serve_static(self, path):
            rel = "index.html" if path == "/" else path.lstrip("/")
            target = (STATIC_DIR / rel).resolve()
            if not target.is_relative_to(STATIC_DIR.resolve()) or not target.is_file():
                raise ApiError(404, "Nicht gefunden.")
            content_type = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
            self.send_bytes(200, target.read_bytes(), content_type)

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = dispatch

    return Handler


def pdf_text_portable(data):
    """PDF-Text ohne macOS (Windows): mit dem mitgelieferten Modul pypdf, gleiche Ausgabe wie pdftext.js."""
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError:
        raise ApiError(501, "Das Einlesen von PDFs ist in dieser Installation nicht verfügbar.")
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages[:60]]
        return {"pages": len(reader.pages), "text": "\n".join(pages)}
    except (PdfReadError, ValueError, KeyError, TypeError) as err:
        raise ApiError(500, f"Die PDF ließ sich nicht lesen ({type(err).__name__}).")


def create_server(port=4390, data_dir=DEFAULT_DATA_DIR):
    """Bereitet die Datenablage vor und liefert den Server, ohne ihn zu starten."""
    data_dir.mkdir(parents=True, exist_ok=True)
    data_dir.chmod(0o700)
    db_path = data_dir / "crm.sqlite"
    db = Database(db_path)
    backups = data_dir / "Sicherungen"
    db.migrate(backups)
    db_path.chmod(0o600)
    db.backup(backups)
    return ThreadingHTTPServer((HOST, port), make_handler(Api(db, backups), port))


def main():
    parser = argparse.ArgumentParser(description="Lokales CRM")
    parser.add_argument("--port", type=int, default=4390)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_DIR, help="Ordner für Datenbank und Sicherungen")
    args = parser.parse_args()

    server = create_server(args.port, args.data)
    print(f"CRM läuft auf http://{HOST}:{args.port}  (Daten: {args.data})  Beenden mit Strg+C", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
