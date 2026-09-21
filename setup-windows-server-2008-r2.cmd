@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo =============================================
echo Tencent Meeting Booking - Windows Server 2008 R2
 echo =============================================
echo.

if exist "D:\nodejs\node.exe" set "PATH=D:\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto NODE_MISSING

echo Node.js:
node -v

echo npm:
call npm -v
if errorlevel 1 goto NPM_MISSING

node -e "process.exit(/^v12\.22\.12$/.test(process.version) ? 0 : 1)"
if errorlevel 1 goto BAD_NODE

echo.
echo [1/4] Cleaning old dependencies...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /f /q "package-lock.json"
if exist "node_modules" goto CLEAN_FAILED

echo.
echo [2/4] Installing dependencies...
call npm install --registry=https://registry.npmmirror.com
if errorlevel 1 goto INSTALL_FAILED

echo.
echo [3/4] Creating .env if missing...
if not exist ".env" copy /y ".env.example" ".env" >nul

echo.
echo [4/4] Checking backend and SQLite...
call npm run check
if errorlevel 1 goto CHECK_FAILED
node -e "try{require('better-sqlite3');console.log('SQLite native module: OK')}catch(e){console.error(e.message);process.exit(1)}"
if errorlevel 1 goto SQLITE_FAILED

echo.
echo ============================================
echo Windows Server 2008 R2 setup complete.
echo ============================================
echo.
echo Next steps:
echo 1. Edit .env and set TENCENT_MEETING_TOKEN
echo 2. Confirm HOST=0.0.0.0
echo 3. Run start-server.cmd
echo.
pause
exit /b 0

:NODE_MISSING
echo ERROR: Node.js not found. Expected D:\nodejs\node.exe
pause
exit /b 1

:NPM_MISSING
echo ERROR: npm could not be executed.
pause
exit /b 1

:BAD_NODE
echo ERROR: This package expects Node.js v12.22.12.
pause
exit /b 1

:CLEAN_FAILED
echo ERROR: Could not remove node_modules. Stop Node.js and try again.
pause
exit /b 1

:INSTALL_FAILED
echo ERROR: npm install failed.
pause
exit /b 1

:CHECK_FAILED
echo ERROR: Backend syntax check failed.
pause
exit /b 1

:SQLITE_FAILED
echo ERROR: better-sqlite3 is not working.
pause
exit /b 1
