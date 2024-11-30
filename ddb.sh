VERSION=0.0.0.2
echo "Denis Database $VERSION-alpha, All rights reserved. (https://denisdb.agnozia.com)"
if lsof -i:5142 > /dev/null; then
  echo "Denis Database runs on 5142 port but this port currently using from another application or services."
  echo "Stop the other service (If its not import)"
  echo " * in linux: sudo systemctl stop (service that using 5142 port)"
else
  echo "Denis Database starting..."
  java -Dfile.encoding=UTF-8 -cp "denis-$VERSION-alpha.jar:lib/*" github.hacimertgokhan.Main
fi

