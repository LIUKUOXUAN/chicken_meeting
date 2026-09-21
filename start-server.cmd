@echo off
setlocal
cd /d "%~dp0"
if exist "D:\nodejs\node.exe" set "PATH=D:\nodejs;%PATH%"
call npm start
