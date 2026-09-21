@echo off
set PATH=D:\nodejs;%PATH%
where node
node -v
call npm -v
call npm run check
node -e "try{require('better-sqlite3');console.log('SQLite OK')}catch(e){console.error(e.message);exitCode=1}"
pause
