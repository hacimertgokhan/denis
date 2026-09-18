#!/usr/bin/env sh
VERSION=$(awk -F= '/^sem_ver=/{print $2}' denis.conf)
echo "Denis Database Integrated CLI (jcli-lnx-0.0.2alpha)"
java -Dfile.encoding=UTF-8 -jar "denis-$VERSION-alpha.jar" cli "$@"
