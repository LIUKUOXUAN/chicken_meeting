@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "C:\nodejs\node.exe" (
  echo ERROR: C:\nodejs\node.exe not found.
  echo Extract Node.js v12.22.12 x64 ZIP to C:\nodejs first.
  pause
  exit /b 1
)

set "APPDIR=%~dp0"
set "CMDPATH=%APPDIR%start-server.cmd"

schtasks /Create /TN "TencentMeetingBooking" /TR "cmd /c \"%CMDPATH%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo ERROR: Could not create scheduled task.
  pause
  exit /b 1
)

echo Autostart task created: TencentMeetingBooking
echo App directory: %APPDIR%
pause
