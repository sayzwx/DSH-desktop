; DSH Desktop — Inno Setup 安装向导脚本
; 生成真正的一键安装器：双击向导 → 下一步 → 安装 → 自动拉引擎/建快捷方式 → 启动。
; 用 ISCC 编译：iscc dsh-installer.iss
;   /DStagingDir=<stage> /DMyAppVersion=<ver> /DOutputDir=<dist>
; 前提：installer 同目录已用 build-dist.ps1 建好 stage（app/config/tools/setup*.ps1 等）。

#ifndef MyAppVersion
  #define MyAppVersion "0.4.1"
#endif
#ifndef StagingDir
  #define StagingDir "..\dist\stage\DSH-Desktop-v0.4.1"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define MyAppName "DSH Desktop"
#define MyAppExe "{localappdata}\DSH\app\DSH.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={localappdata}\DSH
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=DSH-Desktop-v{#MyAppVersion}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
SetupIconFile=..\DSH.ico
ShowLanguageDialog=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; 便携 Node + 安装脚本
[Files]
; app 本体（含 Electron 运行时 + 应用代码）
Source: "{#StagingDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; 便携 Node（目标机无需系统 Node）
Source: "{#StagingDir}\tools\node\*"; DestDir: "{app}\tools\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; 配置模板与安装脚本
Source: "{#StagingDir}\config\*"; DestDir: "{app}\config"; Flags: ignoreversion recursesubdirs
Source: "{#StagingDir}\setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\setup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\check-env.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\安装说明.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"
Name: "{userstartup}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"

[Run]
; 后台自动完成：写配置 → 建快捷方式 → 拉取并构建 Harness 引擎（全程隐藏窗口，日志可查）
Filename: "{cmd}"; Parameters: "/c ""{app}\setup.bat"" -InnoSetup"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
; 安装完成页：可选立即启动
Filename: "{#MyAppExe}"; Description: "启动 DSH Desktop"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 仅移除 Inno 直接安装的 app / tools / config 子目录；harness 引擎与 ~/.dsh 用户数据保留，
; 由用户自行清理（避免卸载误删会话/引擎/配置）。
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\config"
