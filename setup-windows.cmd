@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo Tencent Meeting Booking - Windows Setup
echo ============================================

echo.
echo [1/4] Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 goto NODE_MISSING
node -v
call npm -v
if errorlevel 1 goto NPM_MISSING

echo.
echo [2/4] Cleaning old dependencies...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /f /q "package-lock.json"

if exist "node_modules" goto CLEAN_FAILED

echo.
echo [3/4] Installing dependencies...
call npm install
if errorlevel 1 goto INSTALL_FAILED

echo.
echo [4/4] Creating .env...
if not exist ".env" copy /y ".env.example" ".env" >nul

echo.
echo ============================================
echo Setup complete.
echo ============================================
echo.
echo Next steps:
echo 1. Run: notepad .env
echo 2. Set TENCENT_MEETING_TOKEN
echo 3. Change ADMIN_PASSWORD and ADMIN_SESSION_SECRET
echo 4. Run: npm run check
echo 5. Run: npm start
echo 6. Open: http://localhost:3000

echo.
pause
exit /b 0

:NODE_MISSING
echo.
echo ERROR: Node.js was not found in PATH.
echo Please install Node.js LTS, reopen this window, and run this script again.
pause
exit /b 1

:NPM_MISSING
echo.
echo ERROR: npm could not be executed.
echo Please reopen PowerShell or Command Prompt after installing Node.js.
pause
exit /b 1

:CLEAN_FAILED
echo.
echo ERROR: Could not remove node_modules.
echo Close VS Code, terminals, Explorer windows, or running Node processes using this folder.
pause
exit /b 1

:INSTALL_FAILED
echo.
echo ERROR: npm install failed.
echo Review the npm error messages above.
pause
exit /b 1
