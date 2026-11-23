@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instaluji knihovny...
  call npm install
)
call npm start
pause
