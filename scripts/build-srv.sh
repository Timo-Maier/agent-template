#!/bin/sh
set -e

cd "$(dirname "$0")/.."

TARGET=gen/src

rm -rf "$TARGET"
mkdir -p "$TARGET"

cp -r src/            "$TARGET/src"
cp    package.json    "$TARGET/package.json"
cp    package-lock.json "$TARGET/package-lock.json"
