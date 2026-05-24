@echo off
setlocal

set SOURCE_DIR=%~dp0
set INSTALL_DIR=%USERPROFILE%\.denis
set BIN_DIR=%USERPROFILE%\bin

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
xcopy "%SOURCE_DIR%*" "%INSTALL_DIR%\" /E /I /Y > nul
copy "%INSTALL_DIR%\bin\denis.bat" "%BIN_DIR%\denis.bat" > nul

echo Denis installed to %INSTALL_DIR%
echo Command copied to %BIN_DIR%\denis.bat
echo If needed, add %BIN_DIR% to your PATH.
