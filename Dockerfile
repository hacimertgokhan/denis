# syntax=docker/dockerfile:1.7
#
# Denis Database — multi-stage image.
#   docker build -t denis .
#   docker run -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=crm -e DENIS_BOOTSTRAP_GROUP_PASSWORD=change-me denis
#
# Runtime state (denis.properties, denis.toml, ddb.json, pawd.dat, database.bin,
# logs/) lives in /data — mount a volume there to keep it. STOPSIGNAL SIGTERM
# lets the shutdown hook flush database.bin before the process exits.

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
# Dependencies first so source edits do not invalidate the download layer.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests dependency:go-offline || true
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package \
 && cp target/denis-[0-9]*.jar /denis.jar

FROM eclipse-temurin:17-jre
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/hacimertgokhan/denis" \
      org.opencontainers.image.title="Denis Database" \
      org.opencontainers.image.description="Denis Database — in-memory key-value store with persisted keys, a SQL subset and an MCP server" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT"

RUN useradd --system --uid 10001 --home /data denis \
 && mkdir -p /app /data && chown denis:denis /data
COPY --from=build /denis.jar /app/denis.jar
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER denis
WORKDIR /data
VOLUME ["/data"]

ENV DDB_PORT=5142 \
    DDB_ADDRESS=0.0.0.0 \
    DENIS_BIND_ADDRESS=0.0.0.0 \
    DENIS_LANGUAGE=en \
    JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8 -Djava.security.egd=file:/dev/./urandom"
EXPOSE 5142

# PING needs no login, so the check works on a fresh container.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/${DDB_PORT} && echo PING >&3 && read -t 3 -r line <&3 && [ "$line" = PONG ]'

STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["server"]
