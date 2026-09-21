# Licensing — how it works in practice

Implements `docs/LICENSING_SPEC.md`. Ed25519, verified offline, in the Electron
main process, before the application server is started.

## Minting keys

```
node scripts/mint-license.mjs --type admin --name "Wesley"
node scripts/mint-license.mjs --type student --days 14 --machine <machine_id>
```

The token goes to stdout on its own, so it pipes cleanly; the human-readable
summary goes to stderr.

`.license-private-key.pem` is the signing key. It is gitignored, mode 600, and
never packaged — the app ships only `electron/license/license-public-key.pem`.
**If it is lost, every key ever issued stays valid and no new ones can be made.
If it leaks, anyone can mint admin keys.** Back it up somewhere that is neither
this repository nor a shipped build.

## Where the gate sits

In the main process, in front of the server — not inside the web app. With no
valid license the Next server is never started at all, so there is no page to
navigate to and nothing to bypass. Verified: launching unlicensed produces an
activation window and no listening port.

## The four checks

| Check | Rule |
| --- | --- |
| Signature | Ed25519 over the exact payload bytes that travel in the token |
| Expiry | `student` expires at `expiresAt`; `admin` never expires |
| Machine | A `student` key carrying a `machineId` only opens on that machine |
| Clock | Refuses everything if the clock has moved behind the last launch |

Clock rollback is checked first and refuses *everything*, including admin keys:
once the clock has moved backwards, every time-based check after it is
meaningless. The tamper flag is sticky — putting the clock back does not
silently restore access, because a check you can undo is not a check.

## Hardening, honestly

The main process and the verifier are bundled and compiled to V8 bytecode with
bytenode (`npm run electron:compile`, run automatically by `electron:build`),
and DevTools are disabled in packaged builds.

This raises the cost of reading and patching the licensing logic. It does not
make it impossible: bytecode can be disassembled, and the check runs on a
machine the user controls. Anyone determined enough will get past it. It is a
lock on a door, not a vault — it keeps honest people honest and makes casual
copying inconvenient.

Bytecode must be produced by the V8 that will run it, so `compile-main.mjs`
runs under Electron and refuses to run under system Node. Compiling with the
wrong Node would fail at launch, on someone else's machine.

## Testing

`src/lib/license/license.test.ts` requires the same CommonJS the main process
loads, rather than a transpiled copy, and signs with a throwaway keypair so the
suite never needs the real one. It covers forged and swapped signatures,
payloads edited after signing, expiry boundaries, machine mismatch, and the
rollback that would otherwise revive an expired key.
