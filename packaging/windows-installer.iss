; Installationsprogramm für Windows 11 (Inno Setup 6).
; Aufruf: iscc /DAppVersion=1.0.0 packaging\windows-installer.iss
; Installiert ohne Administratorrechte für das eigene Benutzerkonto. Die Daten liegen getrennt
; in %LOCALAPPDATA%\Meerkoetter-CRM und bleiben beim Deinstallieren erhalten.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{C84DF4E4-560D-4E6B-9C1B-0211CD639B4E}
AppName=Meerkötter CRM
AppVersion={#AppVersion}
AppVerName=Meerkötter CRM {#AppVersion}
AppPublisher=Jens Meerkötter
AppPublisherURL=https://meerkoetter.at
DefaultDirName={autopf}\Meerkoetter CRM
DefaultGroupName=Meerkötter CRM
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
OutputDir=..\dist
OutputBaseFilename=Meerkoetter-CRM-{#AppVersion}-Windows-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Meerkoetter-CRM.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Verknüpfung auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"

[Files]
Source: "..\dist\Meerkoetter-CRM\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Meerkötter CRM"; Filename: "{app}\Meerkoetter-CRM.exe"
Name: "{autodesktop}\Meerkötter CRM"; Filename: "{app}\Meerkoetter-CRM.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Meerkoetter-CRM.exe"; Description: "Meerkötter CRM jetzt starten"; Flags: nowait postinstall skipifsilent
