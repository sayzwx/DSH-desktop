@echo off
title DSH Desktop Installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. See messages above.
  pause
)
rem 清理安装暂存目录（SFX 解压位置 %LOCALAPPDATA%\DSH\stage；失败可忽略）
if /i "%~dp0"=="%LOCALAPPDATA%\DSH\stage\" (
  cd /d "%TEMP%"
  rd /s /q "%LOCALAPPDATA%\DSH\stage" >nul 2>&1
)
