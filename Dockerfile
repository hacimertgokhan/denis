# syntax=docker/dockerfile:1.7
#
# Denis Database — multi-stage, multi-arch (amd64, arm64: Raspberry Pi and other small boards).
#   docker build -t denis .
#   docker run -d -p 5142:5142 -v denis-data:/data \
#     -e DENIS_BOOTSTRAP_GROUP=admin -e DENIS_BOOTSTRAP_GROUP_PASSWORD=change-me denis
#
# Everything the server writes (denis.properties, denis.toml, ddb.json, data/,
# data/backups/) lives in /data — mount a volume there to keep it.

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
# Dependencies first so source edits do not invalidate the download layer.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests dependency:go-offline || true
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package \
 && cp "$(ls target/denis-*.jar | head -n 1)" /denis.jar

FROM eclipse-temurin:17-jre-alpine
LABEL org.opencontainers.image.source="https://github.com/hacimertgokhan/denis" \
      org.opencontainers.image.description="Denis Database — in-memory key-value and SQL database with a write-ahead log" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN addgroup -S -g 10001 denis && adduser -S -u 10001 -G denis -h /data denis \
 && mkdir -p /app /data && chown denis:denis /data
COPY --from=build /denis.jar /app/denis.jar
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER denis
WORKDIR /data
VOLUME ["/data"]

# Listen on every interface inside the container; publish the port to control exposure.
ENV DDB_PORT=5142 \
    DENIS_BIND_ADDRESS=0.0.0.0 \
    DENIS_LOG_FILE=none \
    JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8"
EXPOSE 5142

# PING needs no login, so the check works on a fresh container.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD echo PING | nc -w 3 127.0.0.1 "${DDB_PORT}" | grep -q PONG

# exec form + entrypoint that execs java: SIGTERM reaches the JVM, which checkpoints before exiting
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]
