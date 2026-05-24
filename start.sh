#!/usr/bin/env sh
VERSION=$(awk -F= '/^sem_ver=/{print $2}' denis.conf)
echo "Denis Database $VERSION-alpha, All rights reserved. (https://denisdb.vercel.app)"
if command -v lsof >/dev/null 2>&1 && lsof -i:5142 > /dev/null; then
  echo "Denis Database runs on 5142 port but this port currently using from another application or services."
  echo "Stop the other service (If its not important)"
  echo " * in linux: sudo systemctl stop (service that using 5142 port)"
else
  echo "Denis Database starting..."
  java -Dfile.encoding=UTF-8 -jar "denis-$VERSION-alpha.jar" server
fi
