@echo off
rem ============================================================
rem  DeepSeek Harness 桌面端启动器
rem  -----------------------------------------------
rem  直接启动 electron.exe（GUI 程序，无控制台窗口）：
rem  - 不会再弹出 npm / cmd 终端
rem  - 关闭应用窗口即退出，终端不存在所以也不会有"关终端=杀 UI"
rem  - 需要看启动日志排查问题时，请改用 `npm start` 在终端运行
rem  - 注意：应用路径参数要用 "%~dp0." 而不是 "%~dp0"——
rem    %~dp0 以反斜杠结尾，`"...\"` 会把结束引号转义掉导致
rem    Electron 报 "Unable to find Electron app"（D:\DSH-desktop"）
rem ============================================================
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
