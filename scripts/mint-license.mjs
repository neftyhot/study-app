/**
 * Mints license tokens (docs/LICENSING_SPEC.md §4).
 *
 *   node scripts/mint-license.mjs --type admin
 *   node scripts/mint-license.mjs --type student --days 14 --machine <machine_id>
 *
 * Developer-only. It reads `.license-private-key.pem`, which is gitignored and
 * never packaged — the shipped app carries only the public half, which is the
 * whole point of signing these asymmetrically.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const PRIVATE_KEY_PATH = ".license-private-key.pem";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage(message) {
  console.error(
    `${message}\n\n` +
      "  node scripts/mint-license.mjs --type admin\n" +
      "  node scripts/mint-license.mjs --type student --days 14 [--machine <id>] [--name <who>]\n",
  );
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const type = args.type;

  if (type !== "admin" && type !== "student") {
    usage("--type must be 'admin' or 'student'.");
  }

  let key;
  try {
    key = createPrivateKey(readFileSync(PRIVATE_KEY_PATH));
  } catch {
    usage(
      `Could not read ${PRIVATE_KEY_PATH}. It is the developer's signing key and is never committed.`,
    );
  }

  if (key.asymmetricKeyType !== "ed25519") {
    usage(`${PRIVATE_KEY_PATH} is not an Ed25519 key.`);
  }

  const payload = {
    id: randomUUID(),
    type,
    issuedAt: Date.now(),
  };

  if (args.name && typeof args.name === "string") payload.name = args.name;

  if (type === "student") {
    const days = Number(args.days ?? 14);
    if (!Number.isFinite(days) || days <= 0) {
      usage("--days must be a positive number.");
    }

    payload.expiresAt = Date.now() + days * 86_400_000;

    if (typeof args.machine === "string") {
      payload.machineId = args.machine;
    } else {
      console.error(
        "warning: no --machine given, so this key will work on any computer.\n",
      );
    }
  }

  // The exact bytes that get signed are the bytes that travel, so verification
  // never has to reproduce this serialisation.
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign(null, payloadBytes, key);

  const token = Buffer.from(
    JSON.stringify({
      payload: payloadBytes.toString("base64"),
      signature: signature.toString("base64"),
    }),
    "utf8",
  ).toString("base64");

  console.error(
    `${type} license${payload.expiresAt ? `, expires ${new Date(payload.expiresAt).toISOString().slice(0, 10)}` : ", never expires"}${
      payload.machineId ? `, locked to ${payload.machineId}` : ""
    }\n`,
  );
  // The token alone goes to stdout, so it can be piped or copied cleanly.
  console.log(token);
}

main();
