@echo off
rem Installs the Denis bundle this file came with (see install.ps1 for options).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
