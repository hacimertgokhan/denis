#!/usr/bin/env sh
set -eu

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR="${DENIS_HOME:-$HOME/.denis}"
BIN_DIR="${DENIS_BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
cp -R "$SOURCE_DIR"/. "$INSTALL_DIR"/
ln -sf "$INSTALL_DIR/bin/denis" "$BIN_DIR/denis"

echo "Denis installed to $INSTALL_DIR"
echo "Command linked at $BIN_DIR/denis"
echo "If needed, add $BIN_DIR to your PATH."
