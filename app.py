"""Meerkötter CRM als App: startet den lokalen Server und zeigt das CRM in einem eigenen Fenster.

Mac: WebKit-Fenster, Windows 11: Edge-WebView2-Fenster. Schließen des Fensters beendet das CRM.
"""
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import webview

import server

# Zum Testen mit eigenem Datenordner und Anschluss, nie mit den echten Daten.
PORT = int(os.environ.get("MEERKOETTER_CRM_PORT", "4390"))
DATA_DIR = Path(os.environ["MEERKOETTER_CRM_DATA"]) if os.environ.get("MEERKOETTER_CRM_DATA") else server.DEFAULT_DATA_DIR
URL = f"http://{server.HOST}:{PORT}"
TITLE = "Meerkötter CRM"


def already_running():
    """Läuft das CRM schon (zweites Öffnen der App oder Entwicklerstart), wird nur ein Fenster geöffnet."""
    try:
        with urllib.request.urlopen(f"{URL}/api/meta", timeout=1) as res:
            return "statuses" in json.loads(res.read())
    except (OSError, ValueError, urllib.error.URLError):
        return False


def quiet_streams(data_dir):
    """Ohne Konsole gibt es keine Standardausgabe; Meldungen gehen in eine kleine Protokolldatei."""
    if sys.stdout is None or sys.stderr is None:
        data_dir.mkdir(parents=True, exist_ok=True)
        log = open(data_dir / "app.log", "w", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


class Bridge:
    """Aus der Oberfläche aufrufbar: Speichern mit dem Dialog des Betriebssystems, weil Fenster keine Downloads kennen."""

    def save_download(self, path, filename):
        if not isinstance(path, str) or not path.startswith("/api/") or "://" in path:
            return {"error": "Ungültige Adresse."}
        window = webview.windows[0]
        dialog = getattr(getattr(webview, "FileDialog", None), "SAVE", None) or webview.SAVE_DIALOG
        choice = window.create_file_dialog(dialog, save_filename=Path(str(filename)).name)
        if not choice:
            return {"cancelled": True}
        target = Path(choice if isinstance(choice, str) else choice[0])
        request = urllib.request.Request(f"{URL}{path}", headers={"Host": f"{server.HOST}:{PORT}"})
        with urllib.request.urlopen(request, timeout=120) as res:
            target.write_bytes(res.read())
        return {"saved": target.name}


def remote_url():
    """Läuft das CRM zentral auf einem Server, steht dessen Adresse in server-adresse.txt im Datenordner."""
    try:
        url = (DATA_DIR / "server-adresse.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return url if url.startswith("https://") else None


def main():
    quiet_streams(DATA_DIR)
    remote = remote_url()
    if remote:
        # Zentraler Betrieb: kein lokaler Server, das Fenster zeigt die Webapp auf dem Server (mit Anmeldung).
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.create_window(TITLE, remote, width=1320, height=880, min_size=(900, 600), text_select=True)
        webview.start(private_mode=False, storage_path=str(DATA_DIR / "Fenster"))
        return
    httpd = None
    if not already_running():
        try:
            httpd = server.create_server(PORT, DATA_DIR)
        except OSError:
            webview.create_window(TITLE, html=(
                "<body style='font-family:system-ui;padding:32px'><h2>Das CRM kann nicht starten</h2>"
                f"<p>Ein anderes Programm belegt den Anschluss {PORT}. Bitte den Rechner neu starten "
                "und die App erneut öffnen.</p></body>"), width=520, height=260)
            webview.start()
            return
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.create_window(TITLE, URL, js_api=Bridge(), width=1320, height=880, min_size=(900, 600),
                          text_select=True)
    storage = DATA_DIR / "Fenster"  # merkt sich Sortierung und Arbeitsliste zwischen den Starts
    webview.start(private_mode=False, storage_path=str(storage))
    if httpd:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    main()
