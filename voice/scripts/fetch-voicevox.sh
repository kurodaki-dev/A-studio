#!/usr/bin/env bash
# Fetches the official VOICEVOX native parts that the Android extension APK packages
# (nothing of this is committed; the build runs this first):
#  - voicevoxcore-android AAR (VOICEVOX CORE Java API, MIT licence),
#  - the VOICEVOX build of ONNX Runtime for Android arm64 (needed by the protected
#    "vv_bin" voice models).
# The voices themselves (s0.vvm) and the dictionary are downloaded by the app at runtime.
set -euo pipefail
CORE=0.17.1
ORT=1.23.2
here="$(cd "$(dirname "$0")/.." && pwd)"
app="$here/android/app"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$app/libs" "$app/src/main/jniLibs/arm64-v8a"

if [ ! -f "$app/libs/voicevoxcore-android-$CORE.aar" ]; then
  curl -fsSL -o "$tmp/java_packages.zip" "https://github.com/VOICEVOX/voicevox_core/releases/download/$CORE/java_packages.zip"
  unzip -q -o -j "$tmp/java_packages.zip" "jp/hiroshiba/voicevoxcore/voicevoxcore-android/$CORE/voicevoxcore-android-$CORE.aar" -d "$app/libs"
fi

if [ ! -f "$app/src/main/jniLibs/arm64-v8a/libvoicevox_onnxruntime.so" ]; then
  curl -fsSL -o "$tmp/ort.tgz" "https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-$ORT/voicevox_onnxruntime-android-arm64-$ORT.tgz"
  mkdir -p "$tmp/ort"
  tar -xzf "$tmp/ort.tgz" -C "$tmp/ort"
  so="$(find "$tmp/ort" -name 'libvoicevox_onnxruntime.so' | head -1)"
  test -n "$so"
  cp "$so" "$app/src/main/jniLibs/arm64-v8a/libvoicevox_onnxruntime.so"
fi
ls -la "$app/libs" "$app/src/main/jniLibs/arm64-v8a"
