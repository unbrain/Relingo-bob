#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
RELEASE_DIR="$ROOT_DIR/release"
INFO_FILE="$SRC_DIR/info.json"
APPCAST_FILE="$ROOT_DIR/appcast.json"

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$INFO_FILE")"
IDENTIFIER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identifier"])' "$INFO_FILE")"
MIN_BOB="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["minBobVersion"])' "$INFO_FILE")"
DESC="${1:-v${VERSION} 更新}"

mkdir -p "$RELEASE_DIR"
OUT_FILE="$RELEASE_DIR/relingo_bob${VERSION}.bobplugin"
rm -f "$OUT_FILE"

(cd "$SRC_DIR" && zip -q -r "$OUT_FILE" .)

SHA256="$(shasum -a 256 "$OUT_FILE" | awk '{print $1}')"
TIMESTAMP_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"

python3 - "$APPCAST_FILE" "$IDENTIFIER" "$VERSION" "$DESC" "$SHA256" "$MIN_BOB" "$TIMESTAMP_MS" <<'PY'
import json
import sys
from pathlib import Path

appcast_path = Path(sys.argv[1])
identifier, version, desc, sha256, min_bob, ts_ms = sys.argv[2:8]

if appcast_path.exists():
    data = json.loads(appcast_path.read_text(encoding="utf-8"))
else:
    data = {"identifier": identifier, "versions": []}

data["identifier"] = identifier
versions = [v for v in data.get("versions", []) if v.get("version") != version]
versions.insert(0, {
    "version": version,
    "desc": desc,
    "sha256": sha256,
    "url": f"https://github.com/unbrain/Relingo-bob/releases/download/v{version}/relingo_bob{version}.bobplugin",
    "minBobVersion": min_bob,
    "timestamp": int(ts_ms),
})
data["versions"] = versions
appcast_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "Built: $OUT_FILE"
echo "SHA256: $SHA256"
