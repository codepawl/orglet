#!/bin/bash
# Import a Developer ID Application P12 into a temporary keychain for CI signing.
# Never print the P12 password. Missing secrets → unsigned make, exit 0.
set +x
set -euo pipefail

github_output="${GITHUB_OUTPUT:-}"
write_output() {
  if [[ -n "$github_output" ]]; then
    printf '%s\n' "$1" >> "$github_output"
  else
    printf '%s\n' "$1"
  fi
}

if [[ -z "${APPLE_CERTIFICATE_P12_BASE64:-}" || -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  write_output 'enabled=false'
  echo 'Developer ID secrets are not available; packaging unsigned.'
  exit 0
fi

if [[ -z "${RUNNER_TEMP:-}" ]]; then
  echo 'RUNNER_TEMP is required.'
  exit 1
fi

CERT_PATH="${RUNNER_TEMP}/developerid.p12"
KEYCHAIN_PATH="${RUNNER_TEMP}/orglet-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
export CERT_PATH

cleanup() {
  rm -f "$CERT_PATH"
}
trap cleanup EXIT

python3 - <<'PY'
import base64, os, pathlib
raw = os.environ["APPLE_CERTIFICATE_P12_BASE64"]
data = base64.b64decode("".join(raw.split()))
if len(data) < 100:
    raise SystemExit("decoded P12 is too small")
pathlib.Path(os.environ["CERT_PATH"]).write_bytes(data)
PY

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productsign

curl -fsSL 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer' \
  -o "${RUNNER_TEMP}/DeveloperIDG2CA.cer"
security import "${RUNNER_TEMP}/DeveloperIDG2CA.cer" -k "$KEYCHAIN_PATH" -T /usr/bin/codesign || true

login_keychain="${HOME}/Library/Keychains/login.keychain-db"
if [[ -f "$login_keychain" ]]; then
  security list-keychains -d user -s "$KEYCHAIN_PATH" "$login_keychain"
else
  security list-keychains -d user -s "$KEYCHAIN_PATH"
fi
security default-keychain -d user -s "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

if ! security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -F 'Developer ID Application:'; then
  echo 'Imported P12 but no Developer ID Application identity was found.'
  exit 1
fi

write_output 'enabled=true'
echo 'Developer ID certificate imported for this job.'
