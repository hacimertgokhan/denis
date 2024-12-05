@echo off
set VERSION=0.0.0.4
echo Denis Database Integrated CLI (0.0.1alpha)
java -Dfile.encoding=UTF-8 -cp "denis-%VERSION%-alpha.jar;lib/*" github.hacimertgokhan.denisdb.cli.CLIMain
