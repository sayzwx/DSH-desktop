@echo off
title DSH Desktop Installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. See messages above.
  pause
)
