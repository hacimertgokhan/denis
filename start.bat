@echo off
chcp 65001 > nul
set VERSION=0.0.2.6.1
echo Denis Veritabanı %VERSION%-alpha, Tüm hakları saklıdır. (https://denisdb.vercel.app)

rem Daha güvenilir port kontrolü
netstat -ano | findstr ":5142 " > nul
if %errorlevel% equ 0 (
   for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5142 " ^| findstr "LISTENING"') do (
       echo Port 5142 zaten kullanımda. PID: %%a
       echo Önce bu işlemi durdurun: taskkill /PID %%a /F
       exit /b 1
   )
)

echo Denis Veritabanı başlatılıyor...
java -Dfile.encoding=UTF-8 -cp "denis-%VERSION%-alpha.jar;lib\*" github.hacimertgokhan.Main