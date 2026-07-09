#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Generates the gsengai DEVELOPMENT signing certificates (ADR-0016):
# a self-signed ES256 (P-256) root CA plus a leaf signing certificate with the
# key-usage / EKU profile the C2PA specification requires for claim signing
# (digitalSignature key usage, emailProtection EKU, CA:FALSE leaf).
#
# DEVELOPMENT ONLY. Anything signed with these certificates fails public trust
# validation by design. See packages/c2pa/dev-certs/README.md and
# docs/CERTIFICATES.md for the production certificate path.
#
# Usage: scripts/gen-dev-certs.sh [output-dir]   (default: packages/c2pa/dev-certs)

set -euo pipefail

OUT_DIR="${1:-packages/c2pa/dev-certs}"
DAYS=3650
mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Root CA (self-signed, P-256)
openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/root.key.pem"
cat >"$WORK/root.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
C = US
O = gsengai dev
CN = gsengai DEV ROOT - NOT TRUSTED - integration testing only
[ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
openssl req -new -x509 -key "$WORK/root.key.pem" -out "$WORK/root.crt.pem" \
  -days "$DAYS" -sha256 -config "$WORK/root.cnf"

# Leaf claim-signing certificate (C2PA cert profile: digitalSignature + emailProtection, not a CA)
openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/leaf.key.pem"
cat >"$WORK/leaf.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
C = US
O = gsengai dev
CN = gsengai DEV SIGNER - NOT TRUSTED - integration testing only
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = emailProtection
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF
openssl req -new -key "$WORK/leaf.key.pem" -out "$WORK/leaf.csr" -config "$WORK/leaf.cnf"
openssl x509 -req -in "$WORK/leaf.csr" -CA "$WORK/root.crt.pem" -CAkey "$WORK/root.key.pem" \
  -CAcreateserial -out "$WORK/leaf.crt.pem" -days "$DAYS" -sha256 \
  -extfile "$WORK/leaf.cnf" -extensions ext

# Outputs: full chain (leaf first) + PKCS#8 leaf key
cat "$WORK/leaf.crt.pem" "$WORK/root.crt.pem" >"$OUT_DIR/dev-cert-chain.pem"
openssl pkcs8 -topk8 -nocrypt -in "$WORK/leaf.key.pem" -out "$OUT_DIR/dev-private-key.pem"

echo "Wrote $OUT_DIR/dev-cert-chain.pem and $OUT_DIR/dev-private-key.pem"
echo "DEV CERTIFICATES ONLY — untrusted by design; do not use in production."
