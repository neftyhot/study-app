# Offline Asymmetric Licensing Specification (Ed25519)

## 1. Core Cryptographic Architecture
- Signature standard: Ed25519 via Node.js standard library (node:crypto).
- Public verification key is embedded into the Electron bundle (license-public-key.pem).
- The developer's private key (.license-private-key.pem) is strictly local and never packaged into client builds.
- License token format: Base64-encoded JSON string containing payload and signature.

## 2. Verification Rules (Enforced in Electron Main Process)
1. Signature Integrity: Cryptographically verify payload against signature using embedded public key.
2. Expiration Check:
   - If payload.type === 'admin': Never expires; bypasses expiration and machine binding checks.
   - If payload.type === 'student': Reject if Date.now() > payload.expiresAt.
3. Hardware Binding:
   - For student keys containing machineId, verify against local hardware ID (node-machine-id). Reject if mismatched.
4. Clock Rollback Protection:
   - Record last_launch_timestamp in local SQLite/JSON store.
   - If Date.now() < last_launch_timestamp, lock the app and flag clock manipulation.
   - Update last_launch_timestamp on every launch.

## 3. License Gate & UI Flow
- Before loading main app windows, check local license store.
- If invalid, expired, or missing: Render Activation Modal:
  - Display user's Machine ID with 'Copy Machine ID' button.
  - Textarea/input to paste base64 License Key.
  - 'Activate' button triggering validation IPC handler.
- If valid: Render app normally. Show subtle tier indicator in Settings.

## 4. Minting Script (Developer Tool)
- Create scripts/mint-license.mjs reading .license-private-key.pem to generate keys.

## 5. Security Hardening
- Disable DevTools in production builds.
- Use bytenode to compile main process and verification logic to V8 bytecode before bundling.
