; DSH Desktop — Inno Setup 一键安装向导（真正安装器，非自解压 7z）
; 功能：
;   1. 用户可选择安装目录（默认 %LOCALAPPDATA%\DSH），app/harness/tools 全部随所选目录布局；
;   2. 进入向导即自动做【环境预检】（check-env.ps1 -Report）：架构 / 网络 / 磁盘 / Node.js，
;      缺失项明确列出，用户可一键继续（安装脚本会补齐 Node 并拉取 harness）；
;   3. 安装脚本接收 -DestDir 参数（用户所选目录），所有依赖自动适配该路径，绝不绑定开发者本机路径。
; 用 ISCC 编译：iscc dsh-installer.iss
;   /DStagingDir=<stage> /DMyAppVersion=<ver> /DOutputDir=<dist> /Q
; 前提：installer 同目录已用 build-dist.ps1 建好 stage（app/config/tools/setup*.ps1/check-env.ps1 等）。

#ifndef MyAppVersion
  #define MyAppVersion "0.5.5"
#endif
#ifndef StagingDir
  #define StagingDir "..\dist\stage\DSH-Desktop-v0.5.5"
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
; 允许用户选择安装目录（问题#5：可自选路径，依赖随之适配）
DisableDirPage=no
DirExistsWarning=no
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
UninstallDisplayIcon={#MyAppExe}
; 安装日志便于排查
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; 便携 Node + 安装脚本
[Files]
; app 本体（含 Electron 运行时 + 应用代码）
Source: "{#StagingDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
; 便携 Node（目标机无需系统 Node），随用户所选目录放 tools\node
Source: "{#StagingDir}\tools\node\*"; DestDir: "{app}\tools\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; 配置模板与安装脚本
Source: "{#StagingDir}\config\*"; DestDir: "{app}\config"; Flags: ignoreversion recursesubdirs
Source: "{#StagingDir}\setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\setup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\check-env.ps1"; DestDir: "{app}"; Flags: ignoreversion
; 环境预检脚本也释放到临时目录，供向导页在安装前运行
Source: "{#StagingDir}\check-env.ps1"; DestDir: "{tmp}"; Flags: dontcopy
Source: "{#StagingDir}\安装说明.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\DSH.ico"
Name: "{userstartup}\DSH"; Filename: "{#MyAppExe}"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\DSH.ico"

[Run]
; 后台自动完成：写配置 → 建快捷方式 → 拉取并构建 Harness 引擎 → 启动新版
; 传入用户所选安装目录（-DestDir "{app}"），所有依赖自动适配该目录
Filename: "{cmd}"; Parameters: "/c ""{app}\setup.bat"" -InnoSetup -DestDir ""{app}"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
; 安装完成页：可选立即启动
Filename: "{#MyAppExe}"; Description: "启动 DSH Desktop"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 仅移除 Inno 直接安装的 app / tools / config 子目录；harness 引擎与 ~/.dsh 用户数据保留，
; 由用户自行清理（避免卸载误删会话/引擎/配置）。
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\config"

[Code]
// ============ 环境预检向导页（问题#5：先检测环境，列出缺失项） ============
var
  EnvPage: TWizardPage;
  EnvMemo: TNewMemo;
  EnvRunBtn: TNewButton;
  EnvOk: Boolean;

procedure ExtractCheckEnv;
begin
  try
    ExtractTemporaryFile('check-env.ps1');
  except
  end;
end;

// 简单 JSON 字符串字段提取（仅用于从 env-report.json 取 nodeVersion/netOk/nodeOk 等短 ASCII 字段；
// 注意：函数不能 forward reference，所以 ExtractJsonStr 必须定义在 RunEnvReport 之前）
function ExtractJsonStr(const Json, Key: String): String;
var
  P, P2: Integer;
  Pat: String;
begin
  Result := '';
  Pat := '"' + Key + '":';
  P := Pos(Pat, Json);
  if P > 0 then begin
    P := P + Length(Pat);
    while (P <= Length(Json)) and (Json[P] = ' ') do P := P + 1;
    if (P <= Length(Json)) and (Json[P] = '"') then P := P + 1;
    P2 := P;
    while (P2 <= Length(Json)) and (Json[P2] <> '"') do P2 := P2 + 1;
    Result := Copy(Json, P, P2 - P);
  end;
end;

// 运行 check-env.ps1 -Report -ReportFile，把 JSON 写到 {tmp}\env-report.txt（UTF-8 no BOM），
// 然后从该文件读出 JSON 提取关键字段组装 UI 文案。
// 历史教训：用 cmd.exe /c "powershell ... > file" 重定向 stdout 在 PS 5.1 上是 UTF-16 LE，
// LoadStringsFromFile 按 ANSI 读全乱码 → 显示「未产生输出（exit X）」。改成 -ReportFile 直写。
function RunEnvReport(): String;
var
  TmpScript, OutFile, Cmd: String;
  ExitCode: Integer;
  Lines: TArrayOfString;
  JsonText: String;
  NodeVer, NetOk, NodeOkStr: String;
begin
  Result := '';
  TmpScript := ExpandConstant('{tmp}\check-env.ps1');
  OutFile := ExpandConstant('{tmp}\env-report.txt');
  DeleteFile(OutFile);
  if not FileExists(TmpScript) then begin
    Result := 'check-env.ps1 未就位（临时文件提取失败）';
    Exit;
  end;
  // 不再依赖 stdout 重定向——-ReportFile 直接写到 ANSI 兼容路径，Inno 后续按行读
  Cmd := '"powershell" -NoProfile -ExecutionPolicy Bypass -File "' + TmpScript + '" -Report -ReportFile "' + OutFile + '"';
  if not Exec('cmd.exe', '/c ' + Cmd, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Result := '环境预检脚本启动失败';
    Exit;
  end;
  if (ExitCode <> 0) then begin
    Result := '环境预检脚本退出码 ' + IntToStr(ExitCode) + '（请手动运行 powershell -File "' + TmpScript + '" -Report 排查）';
    Exit;
  end;
  if not LoadStringsFromFile(OutFile, Lines) or (GetArrayLength(Lines) = 0) then begin
    Result := '环境预检未产生输出（文件为空）';
    Exit;
  end;
  // 单行 JSON，提取关键字段组装 UI
  JsonText := Lines[GetArrayLength(Lines) - 1];
  if Pos('{', JsonText) = 0 then begin
    Result := '环境预检输出不是 JSON：' + JsonText;
    Exit;
  end;
  NodeVer := ExtractJsonStr(JsonText, 'nodeVersion');
  NetOk := ExtractJsonStr(JsonText, 'netOk');
  NodeOkStr := ExtractJsonStr(JsonText, 'nodeOk');
  Result := '环境预检结果：' + #13#10;
  Result := Result + '----------------------------------------' + #13#10;
  if NodeVer <> '' then Result := Result + '  Node.js   : ' + NodeVer + #13#10;
  if NetOk <> '' then Result := Result + '  网络可达  : ' + NetOk + #13#10;
  if NodeOkStr = 'false' then
    Result := Result + '  · Node.js 缺失或版本过低 —— 安装脚本会自动安装到所选目录 tools\\node' + #13#10;
  if NetOk = 'false' then
    Result := Result + '  · 网络可能不可达（registry.npmjs.org 探测失败）—— 安装将尝试国内 npm 镜像' + #13#10;
  Result := Result + #13#10 +
    '说明：安装脚本会在你选择的目录内自动补齐 Node.js 并拉取深空引擎（harness）。' + #13#10 +
    '网络受限时自动走国内镜像（npmmirror / 腾讯云 / 华为云）加速。' + #13#10;
end;

procedure EnvRunBtnClick(Sender: TObject);
var
  Rpt, NodeVer, NetOk: String;
begin
  // 必须先提取 check-env.ps1 到 {tmp}：预检页在安装开始前（wpSelectDir 之后）就运行，
  // 而 [Files] dontcopy 文件只有 ExtractTemporaryFile 才会释放——不能在 ssInstall 阶段才提取。
  ExtractCheckEnv;
  EnvRunBtn.Enabled := False;
  EnvRunBtn.Caption := '检测中…';
  EnvMemo.Text := '正在检查运行环境（架构 / 网络 / 磁盘 / Node.js）…' + #13#10;
  WizardForm.NextButton.Enabled := False;
  Rpt := RunEnvReport();
  EnvMemo.Text := '';
  EnvMemo.Lines.Add('环境预检结果：');
  EnvMemo.Lines.Add('----------------------------------------');
  if Pos('{', Rpt) > 0 then begin
    NodeVer := ExtractJsonStr(Rpt, 'nodeVersion');
    NetOk := ExtractJsonStr(Rpt, 'netOk');
    EnvMemo.Lines.Add('  Node.js   : ' + NodeVer);
    EnvMemo.Lines.Add('  网络可达  : ' + NetOk);
    EnvMemo.Lines.Add('');
    if Pos('架构', Rpt) > 0 then EnvMemo.Lines.Add('  · 处理器架构不支持（需要 64 位），可能无法安装。');
    if Pos('nodeOk":false', Rpt) > 0 then EnvMemo.Lines.Add('  · Node.js 缺失或版本过低 —— 安装脚本会自动安装到所选目录 tools\\node。');
    if Pos('netOk":false', Rpt) > 0 then EnvMemo.Lines.Add('  · 网络可能不可达（registry.npmjs.org 探测失败）—— 安装将尝试国内 npm 镜像。');
    if Pos('磁盘', Rpt) > 0 then EnvMemo.Lines.Add('  · 磁盘空间不足，请清理后再装。');
    EnvMemo.Lines.Add('');
    EnvMemo.Lines.Add('说明：安装脚本会在你选择的目录内自动补齐 Node.js 并拉取深空引擎（harness），');
    EnvMemo.Lines.Add('网络受限时会自动走国内镜像（npmmirror / 腾讯云 / 华为云）加速。');
  end else begin
    EnvMemo.Lines.Add('  ' + Rpt);
  end;
  EnvMemo.Lines.Add('');
  EnvMemo.Lines.Add('（可点击下方"重新检测"随时复查；继续安装将自动补齐所缺依赖）');
  WizardForm.NextButton.Enabled := True;
  // 关键：保留按钮可点击，让用户在向导内随时复查环境（之前禁用导致用户卡死）
  EnvRunBtn.Enabled := True;
  EnvRunBtn.Caption := '重新检测';
  EnvOk := True;
end;

procedure InitializeWizard;
begin
  EnvPage := CreateCustomPage(wpSelectDir, '环境预检', '安装前自动检测运行环境（Node.js / 网络 / 磁盘）');
  EnvMemo := TNewMemo.Create(WizardForm);
  EnvMemo.Parent := EnvPage.Surface;
  EnvMemo.Left := 0;
  EnvMemo.Top := 0;
  EnvMemo.Width := WizardForm.InnerNotebook.ClientWidth;
  EnvMemo.Height := WizardForm.InnerNotebook.ClientHeight - 56;
  EnvMemo.ReadOnly := True;
  EnvMemo.ScrollBars := ssVertical;
  EnvRunBtn := TNewButton.Create(WizardForm);
  EnvRunBtn.Parent := EnvPage.Surface;
  EnvRunBtn.Left := 0;
  EnvRunBtn.Top := EnvMemo.Top + EnvMemo.Height + 8;
  EnvRunBtn.Width := 160;
  EnvRunBtn.Height := 30;
  EnvRunBtn.Caption := '重新检测';
  EnvRunBtn.OnClick := @EnvRunBtnClick;
  EnvOk := False;
  // 关键：进入向导前先把 dontcopy 的 check-env.ps1 释放到 {tmp}，否则 EnvPage 第一次
  // 触发 EnvRunBtnClick 时 FileExists('{tmp}\check-env.ps1') 为假 → 报"未就位"。
  // 历史教训：0.5.x 安装器第一次跑用户看到的就是这个错；放 InitializeWizard 末尾提前提。
  ExtractCheckEnv;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = EnvPage.ID) and (not EnvOk) then begin
    EnvRunBtnClick(nil);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    ExtractCheckEnv;
  end;
end;
