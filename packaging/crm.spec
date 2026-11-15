# PyInstaller-Bauanleitung für Mac (Apple Silicon) und Windows 11.
# Aufruf im Projektordner: pyinstaller --noconfirm packaging/crm.spec
import re
import sys
from pathlib import Path

ROOT = Path(SPECPATH).parent
VERSION = re.search(r'^VERSION = "([^"]+)"', (ROOT / "server.py").read_text(encoding="utf-8"), re.M)[1]
MAC = sys.platform == "darwin"

datas = [
    (str(ROOT / "static"), "static"),
    (str(ROOT / "ocr.js"), "."),
    (str(ROOT / "pdftext.js"), "."),
    (str(ROOT / "ocr.ps1"), "."),
]

a = Analysis(
    [str(ROOT / "app.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=["pypdf"],
    excludes=["tkinter", "unittest", "pydoc"],
)
pyz = PYZ(a.pure)

version_file = None
if not MAC:  # Versionsangaben, die Windows in den Dateieigenschaften zeigt
    parts = tuple(int(x) for x in VERSION.split(".")) + (0,)
    version_file = Path(workpath) / "windows-version.txt"
    version_file.parent.mkdir(parents=True, exist_ok=True)
    strings = {"CompanyName": "Jens Meerkötter", "FileDescription": "Meerkötter CRM", "FileVersion": VERSION,
               "ProductName": "Meerkötter CRM", "ProductVersion": VERSION, "OriginalFilename": "Meerkoetter-CRM.exe"}
    version_file.write_text(
        "VSVersionInfo(ffi=FixedFileInfo(filevers=%r, prodvers=%r), kids=[StringFileInfo([StringTable('040704b0', [%s])]), "
        "VarFileInfo([VarStruct('Translation', [0x0407, 1200])])])"
        % (parts, parts, ", ".join(f"StringStruct({k!r}, {v!r})" for k, v in strings.items())),
        encoding="utf-8")
icon = str(ROOT / "packaging" / ("icon.icns" if MAC else "icon.ico"))

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Meerkoetter-CRM",
    console=False,
    icon=icon,
    target_arch="arm64" if MAC else None,
    version=str(version_file) if version_file else None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Meerkoetter-CRM")

if MAC:
    app = BUNDLE(
        coll,
        name="Meerkoetter CRM.app",
        icon=icon,
        bundle_identifier="at.meerkoetter.crm",
        version=VERSION,
        info_plist={
            "CFBundleDisplayName": "Meerkötter CRM",
            "CFBundleName": "Meerkötter CRM",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": "12.0",
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.business",
        },
    )
