VERSION=$(grep -oP '^sem_ver=\K.*' denis.conf)
echo "Denis Database Integrated CLI (jcli-lnx-0.0.2alpha)"
java -Dfile.encoding=UTF-8 -cp "denis-$VERSION-alpha.jar:lib/*" github.hacimertgokhan.denisdb.cli.CLIMain