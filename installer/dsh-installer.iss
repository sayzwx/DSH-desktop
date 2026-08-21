; DSH Desktop — Inno Setup 安装向导脚本（v0.5.1 规则，对齐 0.5.0）
; 一键安装向导：双击 → 选择安装目录 → 环境预检页 → 安装 → 自动拉引擎/建快捷方式 → 启动。
; 用 ISCC 编译：iscc dsh-installer.iss
;   /DStagingDir=<stage> /DMyAppVersion=<ver> /DOutputDir=<dist>
; 前提：installer 同目录已用 build-dist.ps1 建好 stage（app/config/tools/setup*.ps1 等）。

#ifndef MyAppVersion
  #define MyAppVersion "0.5.3"
#endif
#ifndef StagingDir
  #define StagingDir "..\dist\stage\DSH-Desktop-v0.5.3"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define MyAppName "DSH Desktop"
#define MyAppExe "{app}\app\DSH.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={localappdata}\DSH
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
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
Source: "{#StagingDir}\check-env.ps1"; DestDir: "{tmp}"; Flags: dontcopy
Source: "{#StagingDir}\安装说明.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"
Name: "{userstartup}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"

[Run]
; 后台自动完成：写配置 → 建快捷方式 → 拉取并构建 Harness 引擎（全程隐藏窗口，日志可查 install.log）。
; 传入 -DestDir "{app}"（用户所选目录），setup.ps1 的 app/harness/tools 全部落在该目录下。
Filename: "{cmd}"; Parameters: "/c ""{app}\setup.bat"" -InnoSetup -DestDir ""{app}"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
; 安装完成页：可选立即启动
Filename: "{#MyAppExe}"; Description: "启动 DSH Desktop"; Flags: nowait postinstall skipifsilent

[Code]
var
  EnvPage: TWizardPage;
  EnvMemo: TNewMemo;
  EnvDone: Boolean;

procedure InitializeWizard;
begin
  EnvPage := CreateCustomPage(wpSelectDir, '环境预检',
    '安装前自动检查运行环境（CPU 架构 / 网络 / 磁盘空间 / Node.js），缺失项会明确列出。');
  EnvMemo := TNewMemo.Create(EnvPage);
  EnvMemo.Parent := EnvPage.Surface;
  EnvMemo.Left := 0;
  EnvMemo.Top := 0;
  EnvMemo.Width := EnvPage.SurfaceWidth;
  EnvMemo.Height := EnvPage.SurfaceHeight;
  EnvMemo.ReadOnly := True;
  EnvMemo.ScrollBars := ssVertical;
  EnvMemo.Font.Name := 'Consolas';
  EnvMemo.Font.Size := 9;
  EnvDone := False;
end;

procedure RunEnvCheck;
var
  Tmp, ReportFile, Cmd, PolicyFile, PolicyLine: String;
  ResultCode: Integer;
  Lines: TStringList;
begin
  EnvMemo.Lines.Clear;
  EnvMemo.Lines.Add('正在检测环境，请稍候…（架构 / 网络 / 磁盘 / Node.js / 脚本策略）');
  // 从安装包解压 check-env.ps1 到临时目录（[Files] dontcopy 标志）
  try
    ExtractTemporaryFile('check-env.ps1');
  except
  end;
  Tmp := ExpandConstant('{app}');
  ReportFile := ExpandConstant('{tmp}\dsh-env-report.txt');
  Cmd := 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\check-env.ps1') +
         '" -Report -DestDir "' + Tmp + '" > "' + ReportFile + '" 2>&1';
  Exec('cmd.exe', '/c ' + Cmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // 脚本执行策略检测（防呆：Restricted/AllSigned 会阻止引擎拉取）
  PolicyFile := ExpandConstant('{tmp}\dsh-policy.txt');
  Exec('cmd.exe', '/c powershell -NoProfile -Command "Get-ExecutionPolicy" > "' + PolicyFile + '" 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  EnvMemo.Lines.Clear;
  Lines := TStringList.Create;
  try
    if FileExists(ReportFile) then
    begin
      Lines.LoadFromFile(ReportFile);
      if Lines.Count > 0 then
        EnvMemo.Lines.AddStrings(Lines)
      else
        EnvMemo.Lines.Add('（预检无输出，退出码 ' + IntToStr(ResultCode) + '）');
      DeleteFile(ReportFile);
    end
    else
      EnvMemo.Lines.Add('预检脚本未返回结果（退出码 ' + IntToStr(ResultCode) + '）。');
    EnvMemo.Lines.Add('');
    // 执行策略结果
    PolicyLine := '';
    if FileExists(PolicyFile) then
    begin
      Lines.LoadFromFile(PolicyFile);
      if Lines.Count > 0 then PolicyLine := Trim(Lines[0]);
      DeleteFile(PolicyFile);
    end;
    if (PolicyLine = 'Restricted') or (PolicyLine = 'AllSigned') then
    begin
      EnvMemo.Lines.Add('⚠ PowerShell 执行策略：' + PolicyLine + '（受限）');
      EnvMemo.Lines.Add('  这会阻止引擎拉取。安装器已用 -ExecutionPolicy Bypass 运行，通常不受影响；');
      EnvMemo.Lines.Add('  若仍失败，请以管理员身份执行：Set-ExecutionPolicy -Scope CurrentUser RemoteSigned');
    end
    else if PolicyLine <> '' then
      EnvMemo.Lines.Add('PowerShell 执行策略：' + PolicyLine + '（OK）')
    else
      EnvMemo.Lines.Add('PowerShell 执行策略：未能检测');
    EnvMemo.Lines.Add('');
    EnvMemo.Lines.Add('提示：环境不合格项会在安装阶段自动补齐（Node 缺失会自动获取捆绑/系统 Node）；');
    EnvMemo.Lines.Add('若网络不可用导致引擎拉取失败，将写入 install.log 并给出手动安装指引。');
  finally
    Lines.Free;
  end;
  EnvDone := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = EnvPage.ID) and (not EnvDone) then
    RunEnvCheck;
end;

[UninstallDelete]
; 仅移除 Inno 直接安装的 app / tools / config 子目录；harness 引擎与 ~/.dsh 用户数据保留，
; 由用户自行清理（避免卸载误删会话/引擎/配置）。
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\config"
