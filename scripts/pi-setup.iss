; ── Pi Agent Windows Installer ──────────────────────────────────────
; Inno Setup 6 script for pi agent
;
; Features:
;   - User-selectable install directory
;   - User data preservation (auth.json, settings.json, sessions, etc.)
;   - Config file smart update (SYSTEM.md, AGENTS.md only if unchanged)
;   - Uninstaller preserves user data
;
; Build from project root:
;   ISCC.exe scripts\pi-setup.iss /DAppVersion=x.y.z
; ────────────────────────────────────────────────────────────────────

; Source paths are relative to THIS .iss file location (scripts/)
#define BinSrc "..\packages\coding-agent\binaries\windows-x64"

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "Pi Agent"
#define AppPublisher "Earendil Works"
#define AppURL "https://pi.dev"
#define AppExeName "pi.exe"

[Setup]
AppId={{B8E7E0F1-3A2D-4C6B-9F8E-1D5A7C3E0F2A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
OutputDir=..\packages\coding-agent\binaries
OutputBaseFilename=pi-windows-x64-setup-{#AppVersion}
SetupIconFile=
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DirExistsWarning=yes
DisableProgramGroupPage=yes
CloseApplications=force
CloseApplicationsFilter=*.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
english.WelcomeLabel2=This will install {#AppName} {#AppVersion} on your computer.%n%nUser data (auth, settings, sessions, etc.) will be preserved when upgrading.%n%nIt is recommended that you close all other applications before continuing.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

; ── Root program files ──────────────────────────────────────────────

[Files]
; Main executable
Source: "{#BinSrc}\pi.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinSrc}\photon_rs_bg.wasm"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinSrc}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#BinSrc}\README.md"; DestDir: "{app}"; Flags: ignoreversion overwritereadonly
Source: "{#BinSrc}\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion overwritereadonly
Source: "{#BinSrc}\upgrade.ps1"; DestDir: "{app}"; Flags: ignoreversion

; Theme and assets
Source: "{#BinSrc}\theme\*"; DestDir: "{app}\theme"; Flags: ignoreversion recursesubdirs
Source: "{#BinSrc}\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs
Source: "{#BinSrc}\export-html\*"; DestDir: "{app}\export-html"; Flags: ignoreversion recursesubdirs createallsubdirs

; Docs and examples
Source: "{#BinSrc}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs
Source: "{#BinSrc}\examples\*"; DestDir: "{app}\examples"; Flags: ignoreversion recursesubdirs

; Node native modules
Source: "{#BinSrc}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── my-agent: program-controlled subdirs (always overwrite) ────────

; Extensions - always update with installer
Source: "{#BinSrc}\my-agent\extensions\*"; DestDir: "{app}\my-agent\extensions"; Flags: ignoreversion recursesubdirs createallsubdirs

; Skills - always update with installer
Source: "{#BinSrc}\my-agent\skills\*"; DestDir: "{app}\my-agent\skills"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── my-agent: bin tools (overwrite) ────────────────────────────────

Source: "{#BinSrc}\my-agent\bin\fd.exe"; DestDir: "{app}\my-agent\bin"; Flags: ignoreversion
Source: "{#BinSrc}\my-agent\bin\rg.exe"; DestDir: "{app}\my-agent\bin"; Flags: ignoreversion

; ── my-agent: user config files (only install if new, never overwrite) ──

Source: "{#BinSrc}\my-agent\SYSTEM.md"; DestDir: "{app}\my-agent"; Flags: onlyifdoesntexist
Source: "{#BinSrc}\my-agent\AGENTS.md"; DestDir: "{app}\my-agent"; Flags: onlyifdoesntexist
Source: "{#BinSrc}\my-agent\COMMIT.md"; DestDir: "{app}\my-agent"; Flags: onlyifdoesntexist
Source: "{#BinSrc}\my-agent\obsidian-config.json"; DestDir: "{app}\my-agent"; Flags: onlyifdoesntexist
Source: "{#BinSrc}\my-agent\scheduler-tasks-example.json"; DestDir: "{app}\my-agent"; Flags: onlyifdoesntexist

; ── my-agent: prompts (install if new, never overwrite user files) ──
Source: "{#BinSrc}\my-agent\prompts\*"; DestDir: "{app}\my-agent\prompts"; Flags: onlyifdoesntexist recursesubdirs skipifsourcedoesntexist

[Dirs]
; Ensure user data dirs exist (never removed on uninstall)
Name: "{app}\my-agent\sessions"; Flags: uninsneveruninstall
Name: "{app}\my-agent\prompts"; Flags: uninsneveruninstall
Name: "{app}\my-agent\themes"; Flags: uninsneveruninstall
Name: "{app}\my-agent\tools"; Flags: uninsneveruninstall

[UninstallDelete]
; Only delete program-controlled items on uninstall
Type: filesandordirs; Name: "{app}\pi.exe"
Type: filesandordirs; Name: "{app}\photon_rs_bg.wasm"
Type: filesandordirs; Name: "{app}\package.json"
Type: filesandordirs; Name: "{app}\theme"
Type: filesandordirs; Name: "{app}\assets"
Type: filesandordirs; Name: "{app}\export-html"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\docs"
Type: filesandordirs; Name: "{app}\examples"
Type: filesandordirs; Name: "{app}\my-agent\extensions"
Type: filesandordirs; Name: "{app}\my-agent\skills"
Type: filesandordirs; Name: "{app}\my-agent\bin"

[Code]
// ── Preserve user data before uninstall ──────────────────────────────

function InitializeUninstall: Boolean;
var
  UserDataDir: String;
begin
  Result := True;
  UserDataDir := ExpandConstant('{app}\my-agent');

  // Warn user about preserved data
  if DirExists(UserDataDir) then
  begin
    if MsgBox(
      'User data will be preserved in:' + #13#10 +
      UserDataDir + #13#10#13#10 +
      'The following will be kept:' + #13#10 +
      '  auth.json, settings.json, models.json, oauth.json' + #13#10 +
      '  sessions/, prompts/, themes/, tools/' + #13#10 +
      '  SYSTEM.md, AGENTS.md' + #13#10#13#10 +
      'Continue uninstall?',
      mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon
