@echo off
setlocal enabledelayedexpansion
set APP_HOME=%~dp0..
set JAR=

for %%F in ("%APP_HOME%\denis-*.jar") do (
    set JAR=%%~fF
    goto :found
)

:found
if "%JAR%"=="" (
    echo Denis jar was not found in %APP_HOME%
    exit /b 1
)

java -Dfile.encoding=UTF-8 -jar "%JAR%" %*
