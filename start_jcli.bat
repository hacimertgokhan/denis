@echo off
setlocal enabledelayedexpansion
for /f "tokens=1,2 delims==" %%A in (denis.conf) do (
    if "%%A"=="sem_ver" (
        set VERSION=%%B
    )
)
echo "Denis Database Integrated CLI (jcli-win-0.0.1alpha)"
java -Dfile.encoding=UTF-8 -cp "denis-%VERSION%-alpha.jar;lib/*" github.hacimertgokhan.denisdb.cli.CLIMain
