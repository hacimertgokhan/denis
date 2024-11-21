VERSION=$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout)
echo "Denis $VERSION, All rights reserved."
java -Dfile.encoding=UTF-8 -jar DenisDB-$VERSION-jwd.jar
