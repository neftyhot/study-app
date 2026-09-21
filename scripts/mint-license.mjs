/**
 * Mints license tokens (docs/LICENSING_SPEC.md §4).
 *
 *   node scripts/mint-license.mjs --type admin
 *   node scripts/mint-license.mjs --type student --days 14 --machine <machine_id>
 *   node scripts/mint-license.mjs --type lifetime --machine <machine_id>
 *
 * Developer-only. It reads `.license-private-key.pem`, which is gitignored and
 * never packaged — the shipped app carries only the public half, which is the
 * whole point of signing these asymmetrically.
 *
 * Every key minted here is also recorded in `licenses.json`, the same ledger
 * the license manager reads: a key issued at the command line and one issued
 * in the GUI are the same thing and belong in the same place.
 */
import { daysLeft, mintLicense, paths } from "./license-store.mjs";

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
      "  node scripts/mint-license.mjs --type admin [--name <who>]\n" +
      "  node scripts/mint-license.mjs --type student --days 14 [--machine <id>] [--name <who>]\n" +
      "  node scripts/mint-license.mjs --type lifetime --machine <id> [--name <who>]\n\n" +
      "  npm run license:manager   for the GUI\n",
  );
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.type !== "admin" && args.type !== "student" && args.type !== "lifetime") {
    usage("--type must be 'admin', 'student' or 'lifetime'.");
  }

  if (args.type === "student" && typeof args.machine !== "string") {
    console.error(
      "warning: no --machine given, so this key will work on any computer.\n",
    );
  }

  let record;
  try {
    record = mintLicense({
      name: typeof args.name === "string" ? args.name : undefined,
      type: args.type,
      days: args.days,
      machineId: typeof args.machine === "string" ? args.machine : null,
    });
  } catch (error) {
    usage(error.message);
  }

  const remaining = daysLeft(record);

  console.error(
    `${record.type} license${
      record.expiresAt
        ? `, expires ${new Date(record.expiresAt).toISOString().slice(0, 10)} (${remaining} days)`
        : ", never expires"
    }${record.machineId ? `, locked to ${record.machineId}` : ""}\n` +
      `recorded in ${paths().licenses}\n`,
  );

  // The token alone goes to stdout, so it can be piped or copied cleanly.
  console.log(record.token);
}

main();
