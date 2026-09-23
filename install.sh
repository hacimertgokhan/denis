#!/usr/bin/env sh
# Denis Database installer for Linux, macOS and Raspberry Pi / other ARM boards.
#
#   curl -fsSL https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.sh | sh
#   sh install.sh                       (from an extracted release bundle: installs that bundle)
#
# Options (environment variables):
#   DENIS_VERSION=0.7.0     release to download (default: latest)
#   DENIS_INSTALL=~/.denis  installation directory (config and data live here too)
#   DENIS_BIN_DIR=~/.local/bin
#   DENIS_PROFILE=small     tuning preset for small devices (default|small|server)
#   DENIS_SERVICE=1         also install and start a systemd user service (Linux)
#   DENIS_BIND=0.0.0.0      accept connections from other machines (default: local only)
set -eu

REPO="hacimertgokhan/denis"
INSTALL_DIR="${DENIS_INSTALL:-$HOME/.denis}"
BIN_DIR="${DENIS_BIN_DIR:-$HOME/.local/bin}"
PROFILE="${DENIS_PROFILE:-}"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- Java 17+
JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}java"
if ! command -v "$JAVA" >/dev/null 2>&1; then
  say "Denis needs Java 17 or newer, which was not found."
  say "  Debian/Ubuntu/Raspberry Pi OS: sudo apt install -y openjdk-17-jre-headless"
  say "  Fedora: sudo dnf install -y java-17-openjdk-headless"
  say "  macOS:  brew install openjdk@17"
  say "  Other:  https://adoptium.net"
  exit 1
fi
JAVA_MAJOR=$("$JAVA" -version 2>&1 | awk -F '"' '/version/ { split($2, v, "."); print (v[1] == "1" ? v[2] : v[1]); exit }')
if [ -z "$JAVA_MAJOR" ] || [ "$JAVA_MAJOR" -lt 17 ]; then
  fail "Java 17 or newer is required, found: $("$JAVA" -version 2>&1 | head -n 1)"
fi

# ---------------------------------------------------------------- bundle
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo "")
TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT

if [ -n "$SOURCE_DIR" ] && ls "$SOURCE_DIR"/denis-*.jar >/dev/null 2>&1; then
  BUNDLE="$SOURCE_DIR"
  say "Installing the bundle in $BUNDLE"
else
  command -v curl >/dev/null 2>&1 || fail "curl is required to download Denis"
  if [ -n "${DENIS_VERSION:-}" ]; then
    TAG="v${DENIS_VERSION#v}"
  else
    TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$TAG" ] || fail "could not find the latest release of $REPO"
  fi
  VERSION="${TAG#v}"
  TMP=$(mktemp -d)
  URL="https://github.com/$REPO/releases/download/$TAG/denis-$VERSION-project-bundle.tar.gz"
  say "Downloading Denis $VERSION"
  curl -fL --progress-bar "$URL" -o "$TMP/denis.tar.gz" || fail "download failed: $URL"
  if curl -fsSL "$URL.sha256" -o "$TMP/denis.tar.gz.sha256" 2>/dev/null; then
    EXPECTED=$(cut -d ' ' -f 1 < "$TMP/denis.tar.gz.sha256")
    if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TMP/denis.tar.gz" | cut -d ' ' -f 1)
    else ACTUAL=$(shasum -a 256 "$TMP/denis.tar.gz" | cut -d ' ' -f 1); fi
    [ "$EXPECTED" = "$ACTUAL" ] || fail "checksum mismatch for the downloaded bundle"
    say "Checksum verified"
  fi
  mkdir -p "$TMP/bundle"
  tar -xzf "$TMP/denis.tar.gz" -C "$TMP/bundle"
  BUNDLE="$TMP/bundle"
fi

# ---------------------------------------------------------------- install
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
# program files are replaced; configuration and data are never touched
rm -f "$INSTALL_DIR"/denis-*.jar
for item in "$BUNDLE"/denis-*.jar "$BUNDLE"/bin "$BUNDLE"/service "$BUNDLE"/README.md "$BUNDLE"/LICENSE "$BUNDLE"/docs; do
  [ -e "$item" ] && cp -R "$item" "$INSTALL_DIR"/
done
chmod +x "$INSTALL_DIR/bin/denis"
# a forwarding script rather than a symlink: works the same everywhere (Git Bash copies symlinks)
cat > "$BIN_DIR/denis" <<EOF
#!/bin/sh
exec "$INSTALL_DIR/bin/denis" "\$@"
EOF
chmod +x "$BIN_DIR/denis"
say "Installed to $INSTALL_DIR"

# ---------------------------------------------------------------- first run
if [ ! -f "$INSTALL_DIR/denis.properties" ]; then
  set -- init
  [ -n "$PROFILE" ] && set -- "$@" --profile "$PROFILE"
  [ -n "${DENIS_BIND:-}" ] && set -- "$@" --bind "$DENIS_BIND"
  DENIS_HOME="$INSTALL_DIR" "$INSTALL_DIR/bin/denis" "$@"
else
  say "Existing configuration kept: $INSTALL_DIR/denis.properties"
fi

# ---------------------------------------------------------------- service
if [ "${DENIS_SERVICE:-0}" = "1" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    sed -e "s#@DENIS_HOME@#$INSTALL_DIR#g" "$INSTALL_DIR/service/denis-user.service" > "$UNIT_DIR/denis.service"
    systemctl --user daemon-reload
    systemctl --user enable --now denis.service
    say "Service started: systemctl --user status denis"
    say "(to keep it running after logout: sudo loginctl enable-linger $USER)"
  else
    say "systemd not found; start the server with: denis server"
  fi
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Add $BIN_DIR to your PATH, e.g.: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" ;;
esac
say ""
say "Done. Start the server with:  denis server"
