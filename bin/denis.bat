@echo off
rem Denis Database launcher.
rem   denis init ^| server ^| backup ... ^| cli ...
rem Environment: DENIS_HOME (config and data, default: this installation),
rem DENIS_JAVA_OPTS (extra JVM options), JAVA_HOME (Java 17+).
rem no delayed expansion: it would mangle "!" in passwords passed as arguments
setlocal
set "APP_HOME=%~dp0.."
for %%I in ("%APP_HOME%") do set "APP_HOME=%%~fI"
set "JAR="

for %%F in ("%APP_HOME%\denis-*.jar" "%APP_HOME%\lib\denis-*.jar") do (
    if not defined JAR set "JAR=%%~fF"
)
if not defined JAR (
    echo Denis jar was not found in %APP_HOME%
    exit /b 1
)

if defined JAVA_HOME (
    set "JAVA=%JAVA_HOME%\bin\java.exe"
) else (
    set "JAVA=java"
)
where "%JAVA%" >nul 2>nul
if errorlevel 1 if not exist "%JAVA%" (
    echo Java 17 or newer is required. Install it from https://adoptium.net or: winget install EclipseAdoptium.Temurin.17.JRE
    exit /b 1
)

if not defined DENIS_HOME set "DENIS_HOME=%APP_HOME%"
"%JAVA%" -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8 %DENIS_JAVA_OPTS% -jar "%JAR%" %*
exit /b %ERRORLEVEL%
