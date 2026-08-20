@echo off
title DSH Desktop Installer
rem %~dp0 定位到 setup.ps1 所在目录（SFX 解压目录或用户解压目录），与当前目录无关。
set "SCRIPT_DIR=%~dp0"
set "PS=powerShell.exe"
where powershell.exe >nul 2>&1 || set "PS=pwsh.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1" %*
set "RC=%ERRORLEVEL%"
if %RC% NEQ 0 (
  echo.
  echo Install failed (code %RC%^. See messages above.
  echo.
  pause
)
rem 清理安装暂存目录（SFX 解压位置 %LOCALAPPDATA%\DSH\stage；失败可忽略）
if /i "%SCRIPT_DIR%"=="%LOCALAPPDATA%\DSH\stage\" (
  cd /d "%TEMP%"
  rd /s /q "%LOCALAPPDATA%\DSH\stage" >nul 2>&1
)
exit /b %RC%

