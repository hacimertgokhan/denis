@echo off
setlocal
for /f "tokens=2 delims==" %%v in ('findstr /b "sem_ver=" denis.conf') do set VERSION=%%v
echo Denis Database Integrated CLI
java -Dfile.encoding=UTF-8 -jar "denis-%VERSION%-alpha.jar" cli %*
