/**
 * The scaling checklist: everything to buy, publish, set up and send out as
 * Megan Study grows, in order, grouped into milestones.
 *
 * Each item may have a `check` that runs here, in the main process, when its
 * checkmark is clicked. A check answers one of:
 *
 *   pass     verified — the item is marked done
 *   fail     checked, and it is not done yet (`detail` says what is missing)
 *   manual   nothing here can see it (a dashboard, a bank, a purchase); the
 *            window shows the steps and how to verify, and asks to confirm
 *   not-yet  a threshold item that is not needed at the current size
 *
 * Items without a check are `manual`. Progress is kept in scaling.json in the
 * manager's settings folder, beside insights.json.
 */
const { execFile } = require("node:child_process");
const dns = require("node:dns/promises");
const fs = require("node:fs");
const path = require("node:path");

const { admin, readConfig } = require("./insights.js");

const REPO = "neftyhot/study-app";

/* ---------------------------------------------------------------- Helpers */

function stateFile(dir) {
  return path.join(dir, "scaling.json");
}

function readState(dir) {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(dir), "utf8"));
    return { site: saved.site || "", items: saved.items || {} };
  } catch {
    return { site: "", items: {} };
  }
}

function writeState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** A packaged app starts with a bare PATH; gh and wrangler live in Homebrew's. */
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
  .filter(Boolean)
  .join(":");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 30000, maxBuffer: 20 * 1024 * 1024, ...options, env: { ...process.env, PATH } },
      (error, stdout, stderr) => {
        if (error && !options.allowFailure) {
          const text = String(stderr || error.message).trim().split("\n")[0];
          reject(new Error(error.code === "ENOENT" ? `${command} is not installed.` : text));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr), code: error ? error.code : 0 });
        }
      },
    );
  });
}

/** The study-app checkout: the licence folder, the working directory, or this file's. */
function findRepo(candidates) {
  for (const start of candidates.filter(Boolean)) {
    let dir = path.resolve(start);
    for (let i = 0; i < 6; i += 1) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        if (pkg.name === "megan-study" && fs.existsSync(path.join(dir, ".git"))) return dir;
      } catch {
        // Not here; try the parent.
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function once(fn) {
  let promise = null;
  return () => (promise ??= fn());
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------ The checks */

/** Everything a check may need, fetched at most once per round of checks. */
function makeContext(context, state) {
  const dir = context.configDir;
  const repo = findRepo([context.getRoot?.(), process.cwd(), path.join(__dirname, "..", "..")]);

  const needRepo = () => {
    if (!repo) {
      throw new Error(
        "The study-app repository was not found. Use “Change folder…” on the Licences tab to pick the repository folder, then check again.",
      );
    }
    return repo;
  };

  return {
    repo,
    site: state.site,
    workerUrl: readConfig(dir).url.replace(/\/+$/, ""),
    readRepo: (rel) => fs.readFileSync(path.join(needRepo(), rel), "utf8"),
    stats: once(() => admin(dir, "/admin/stats?fresh=1")),
    purchases: once(async () => {
      const list = await admin(dir, "/admin/purchases");
      return Array.isArray(list) ? list : [];
    }),
    ledger: () => context.readLicenses?.() ?? [],
    secrets: once(async () => {
      const { stdout } = await run("gh", ["secret", "list", "-R", REPO, "--json", "name"]);
      return new Set(JSON.parse(stdout).map((s) => s.name));
    }),
    variables: once(async () => {
      const { stdout } = await run("gh", ["variable", "list", "-R", REPO, "--json", "name,value"]);
      return JSON.parse(stdout);
    }),
    latestRelease: once(async () => {
      const { stdout } = await run("gh", [
        "release", "view", "-R", REPO, "--json", "tagName,isDraft,assets,publishedAt",
      ]);
      return JSON.parse(stdout);
    }),
    workerSecrets: once(async () => {
      const cwd = path.join(needRepo(), "workers", "licensing");
      const local = path.join(cwd, "node_modules", ".bin", "wrangler");
      const [command, args] = fs.existsSync(local)
        ? [local, ["secret", "list", "--format", "json"]]
        : ["npx", ["--yes", "wrangler", "secret", "list", "--format", "json"]];
      const { stdout } = await run(command, args, { cwd, timeout: 60000 });
      const start = stdout.indexOf("[");
      return new Set(JSON.parse(stdout.slice(start)).map((s) => s.name));
    }),
  };
}

/** Missing names out of a required set, as a sentence, or null. */
function missing(have, want, where) {
  const gone = want.filter((name) => !have.has(name));
  return gone.length ? `Not set in ${where}: ${gone.join(", ")}.` : null;
}

/** Weekly actives to daily users, roughly: students open it a few days a week. */
const dailyFromWeekly = (active7) => Math.round(active7 / 2.5);
/** KV writes per daily user: up to 6 an hour while studying, 1 an hour idle. */
const KV_WRITES_PER_DAILY_USER = 7;
/** Worker requests per daily user: /status every 2 min plus telemetry, ~2 hours open. */
const REQUESTS_PER_DAILY_USER = 70;

/* ------------------------------------------------------------ Milestones */

const MILESTONES = [
  {
    id: "launch",
    title: "1 · Ready to sell",
    summary: "Before strangers can pay you. Stripe will not keep a live account open without most of these.",
    trigger: null,
  },
  {
    id: "first",
    title: "2 · First customers",
    summary: "Once people you don't know are installing it. Unsigned apps scare buyers off here.",
    trigger: { metric: "active7", at: 25, label: "weekly active installs" },
  },
  {
    id: "growing",
    title: "3 · Growing",
    summary: "Where Cloudflare's free tier runs out — telemetry writes hit the KV limit first.",
    trigger: { metric: "active7", at: 150, label: "weekly active installs" },
  },
  {
    id: "business",
    title: "4 · A real business",
    summary: "Enough money that taxes, liability and bookkeeping need to be done properly.",
    trigger: { metric: "sales", at: 100, label: "sales (~$2,500)" },
  },
  {
    id: "scale",
    title: "5 · Scale",
    summary: "Thousands of students. Watch paid-tier usage and support load.",
    trigger: { metric: "active7", at: 2000, label: "weekly active installs" },
  },
];

/* ----------------------------------------------------------------- Items */

const ITEMS = [
  /* ------------------------------------------------ 1 · Ready to sell */
  {
    id: "worker-live",
    milestone: "launch",
    kind: "set up",
    title: "Licensing server is up",
    why: "Purchases, app status, updates and usage all go through the Cloudflare Worker.",
    cost: "Free",
    steps: [
      "In a terminal: cd workers/licensing",
      "npx wrangler deploy",
      "Check the Worker URL in Usage tab → Connection matches the one it prints.",
    ],
    verify: ["Open <worker>/status in a browser: it shows JSON with \"mode\"."],
    async check(ctx) {
      const response = await fetch(`${ctx.workerUrl}/status`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { status: "fail", detail: `/status answered ${response.status}.` };
      const body = await response.json();
      return { status: "pass", detail: `Answering; mode is “${body.mode}”.` };
    },
  },
  {
    id: "admin-token",
    milestone: "launch",
    kind: "set up",
    title: "This manager is connected with the admin token",
    why: "Every automatic check below that reads sales or installs uses it.",
    cost: "Free",
    steps: [
      "Make a token: openssl rand -hex 32",
      "cd workers/licensing && npx wrangler secret put ADMIN_TOKEN (paste it)",
      "Usage tab → Connection → paste it into Admin token → Save.",
    ],
    verify: ["Usage tab → Refresh shows install numbers without an error."],
    async check(ctx) {
      const stats = await ctx.stats();
      return { status: "pass", detail: `Token accepted; ${plural(stats.installs, "install")} reporting.` };
    },
  },
  {
    id: "worker-secrets",
    milestone: "launch",
    kind: "set up",
    title: "Worker secrets are set (signing key, Stripe webhook, admin token)",
    why: "Without the webhook secret no purchase is accepted; without the key none can be signed.",
    cost: "Free",
    steps: [
      "cd workers/licensing",
      "npx wrangler secret put LICENSE_PRIVATE_KEY < ../../.license-private-key.pem",
      "Stripe dashboard (Live mode) → Developers → Webhooks → your endpoint → Signing secret → Reveal, copy it.",
      "npx wrangler secret put STRIPE_WEBHOOK_SECRET (paste the whsec_… value)",
      "npx wrangler secret put ADMIN_TOKEN if not done above.",
    ],
    verify: ["cd workers/licensing && npx wrangler secret list — all three names are listed."],
    async check(ctx) {
      const have = await ctx.workerSecrets();
      const gap = missing(have, ["LICENSE_PRIVATE_KEY", "STRIPE_WEBHOOK_SECRET", "ADMIN_TOKEN"], "the Worker");
      return gap ? { status: "fail", detail: gap } : { status: "pass", detail: "All three secrets are set." };
    },
  },
  {
    id: "stripe-activate",
    milestone: "launch",
    kind: "set up",
    title: "Activate Stripe live mode and connect a bank account",
    why: "Test-mode payments are not real money, and live payouts need identity and bank details.",
    cost: "2.9% + 30¢ per sale (≈ $1.02 of each $24.95)",
    steps: [
      "dashboard.stripe.com → the “Activate payments” banner (or Settings → Business → Account details).",
      "Enter your legal name, address, date of birth, last 4 of SSN (or EIN if you have a business), and the website from the “Publish a website” item.",
      "Settings → Business → Public details: set the statement descriptor (e.g. MEGANSTUDY), support email and support URL.",
      "Settings → Payouts → add the bank account money should land in.",
    ],
    verify: [
      "The dashboard no longer shows an “Activate” banner.",
      "Balance → Payouts shows your bank account and a payout schedule.",
    ],
  },
  {
    id: "payment-link-live",
    milestone: "launch",
    kind: "publish",
    title: "The app's Buy button opens a live Stripe Payment Link",
    why: "A test link (buy.stripe.com/test_…) takes no real money.",
    cost: "Free",
    steps: [
      "Stripe dashboard, Live mode (toggle top right) → Payment Links → New: product “Megan Study — Lifetime”, $24.95 one-time.",
      "After payment → Don't show confirmation page → Redirect to <worker>/success?session_id={CHECKOUT_SESSION_ID}",
      "Copy the link and put it in PURCHASE_URL in electron/license/purchase.cjs, then release a new version.",
    ],
    verify: ["Open the link: the checkout page has no orange “Test mode” badge."],
    async check(ctx) {
      const source = ctx.readRepo("electron/license/purchase.cjs");
      const url = source.match(/PURCHASE_URL\s*=\s*"([^"]+)"/)?.[1];
      if (!url) return { status: "fail", detail: "PURCHASE_URL was not found in electron/license/purchase.cjs." };
      if (url.includes("/test_")) return { status: "fail", detail: `Still a test link: ${url}` };
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { status: "fail", detail: `${url} answered ${response.status} — is the link deactivated?` };
      return { status: "pass", detail: `Live link, and it opens: ${url}` };
    },
  },
  {
    id: "stripe-webhook",
    milestone: "launch",
    kind: "set up",
    title: "A live purchase reaches the Worker (webhook works end to end)",
    why: "Stripe's live and test webhooks are separate; the live one has to exist and use the live secret.",
    cost: "One $24.95 purchase, refunded (you lose Stripe's ~$1 fee)",
    steps: [
      "Stripe (Live mode) → Developers → Webhooks → Add endpoint: <worker>/stripe/webhook",
      "Events: checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded, charge.dispute.created.",
      "Put that endpoint's signing secret in the Worker (see “Worker secrets”).",
      "In the released app on your Mac: Buy, pay with a real card.",
      "Stripe → Payments → that payment → Refund (full).",
    ],
    verify: [
      "The app unlocks by itself within a minute of paying.",
      "Licences tab → Pull purchases lists it; after the refund it shows as revoked.",
    ],
    async check(ctx) {
      const purchases = await ctx.purchases();
      if (purchases.length === 0) {
        return { status: "fail", detail: "No purchase has reached the Worker yet. Make one test purchase as described." };
      }
      return { status: "pass", detail: `${plural(purchases.length, "key")} minted from Stripe webhooks.` };
    },
  },
  {
    id: "payment-link-lock",
    milestone: "launch",
    kind: "set up",
    title: "Only your Payment Link can mint keys (PAYMENT_LINK_ID)",
    why: "Otherwise any other product sold from the same Stripe account would also mint a Megan Study key.",
    cost: "Free",
    steps: [
      "Stripe → Payment Links → your live link → copy its id (plink_…) from the URL or details.",
      "workers/licensing/wrangler.toml → PAYMENT_LINK_ID = \"plink_…\"",
      "cd workers/licensing && npx wrangler deploy",
    ],
    verify: ["wrangler.toml has the plink_ id and the deploy printed it under “vars”."],
    async check(ctx) {
      const toml = ctx.readRepo("workers/licensing/wrangler.toml");
      const id = toml.match(/PAYMENT_LINK_ID\s*=\s*"([^"]*)"/)?.[1] ?? "";
      if (!id.startsWith("plink_")) return { status: "fail", detail: "PAYMENT_LINK_ID in wrangler.toml is empty." };
      return { status: "pass", detail: `Locked to ${id}. (Deploy the Worker if you just changed it.)` };
    },
  },
  {
    id: "license-url-var",
    milestone: "launch",
    kind: "set up",
    title: "Release builds know the licensing server (LICENSE_SERVER_URL)",
    why: "Without it, released apps can't collect a purchase, check status or report usage.",
    cost: "Free",
    steps: [
      `gh variable set LICENSE_SERVER_URL -R ${REPO} --body <worker URL>`,
      "Tag a new release so the builds pick it up.",
    ],
    verify: [`gh variable list -R ${REPO} shows it.`],
    async check(ctx) {
      const variables = await ctx.variables();
      const found = variables.find((v) => v.name === "LICENSE_SERVER_URL");
      if (!found?.value) return { status: "fail", detail: "The GitHub repository variable is not set." };
      if (found.value.replace(/\/+$/, "") !== ctx.workerUrl) {
        return { status: "fail", detail: `Set to ${found.value}, but this manager talks to ${ctx.workerUrl}.` };
      }
      return { status: "pass", detail: `Set to ${found.value}.` };
    },
  },
  {
    id: "domain",
    milestone: "launch",
    kind: "buy",
    title: "Buy a domain",
    why: "Stripe, email and the website all look far more trustworthy on your own name.",
    cost: "≈ $10–15 / year",
    steps: [
      "dash.cloudflare.com → Domain Registration → Register Domains (at-cost pricing; DNS is already there).",
      "Search, e.g. meganstudy.app, and buy it with auto-renew on.",
      "Type it into “Your website” at the top of this tab and press Save.",
    ],
    verify: ["The domain shows as Active under Websites in Cloudflare."],
    async check(ctx) {
      if (!ctx.site) return { status: "fail", detail: "Type your domain into “Your website” at the top of this tab first." };
      const host = new URL(ctx.site).hostname;
      const addresses = await dns.resolve(host).catch(() => []);
      return addresses.length
        ? { status: "pass", detail: `${host} resolves.` }
        : { status: "fail", detail: `${host} does not resolve yet (DNS can take an hour).` };
    },
  },
  {
    id: "support-email",
    milestone: "launch",
    kind: "set up",
    title: "A support email on your domain",
    why: "Stripe requires a support contact, and buyers need somewhere to ask for help or a refund.",
    cost: "Free (Cloudflare Email Routing) or ≈ $7/month (Google Workspace)",
    steps: [
      "Cloudflare → your domain → Email → Email Routing → Get started.",
      "Add support@yourdomain forwarding to your personal inbox and confirm the email it sends you.",
      "Let Cloudflare add the MX and TXT records it offers.",
      "To reply from that address in Gmail: Settings → Accounts → Send mail as (needs an SMTP provider), or use Google Workspace instead.",
    ],
    verify: ["Send an email to support@yourdomain from another account; it arrives in your inbox."],
    async check(ctx) {
      if (!ctx.site) return { status: "fail", detail: "Type your domain into “Your website” at the top of this tab first." };
      const host = new URL(ctx.site).hostname.replace(/^www\./, "");
      const mx = await dns.resolveMx(host).catch(() => []);
      if (!mx.length) return { status: "fail", detail: `${host} has no MX record, so it can't receive email.` };
      return {
        status: "manual",
        detail: `${host} can receive mail (${mx.map((r) => r.exchange).join(", ")}). Whether it reaches you can only be checked by sending one.`,
      };
    },
  },
  {
    id: "website",
    milestone: "launch",
    kind: "publish",
    title: "Publish a website: download links, privacy policy, terms, refund policy, contact",
    why: "Stripe reviews your site before live payouts, and many buyers look for a real page before paying.",
    cost: "Free (Cloudflare Pages or GitHub Pages)",
    steps: [
      "Make pages: / (what it is, price, download buttons linking to the latest GitHub release), /privacy (paste the app's privacy policy), /terms, /refunds (e.g. “full refund within 14 days, email support@…”), and a contact email.",
      "Cloudflare → Workers & Pages → Create → Pages → upload the folder (or connect a GitHub repo).",
      "Pages project → Custom domains → add your domain.",
      "Put the site URL in Stripe → Settings → Business → Public details.",
    ],
    verify: ["Open yourdomain/, /privacy, /terms and /refunds in a private browser window."],
    async check(ctx) {
      if (!ctx.site) return { status: "fail", detail: "Type your site into “Your website” at the top of this tab first." };
      const base = ctx.site.replace(/\/+$/, "");
      const pages = ["/", "/privacy", "/terms", "/refunds"];
      const results = await Promise.all(
        pages.map(async (page) => {
          try {
            const r = await fetch(`${base}${page}`, { redirect: "follow", signal: AbortSignal.timeout(10000) });
            return [page, r.ok];
          } catch {
            return [page, false];
          }
        }),
      );
      const bad = results.filter(([, ok]) => !ok).map(([page]) => page);
      return bad.length
        ? { status: "fail", detail: `Not reachable: ${bad.join(", ")}` }
        : { status: "pass", detail: `All four pages load from ${base}.` };
    },
  },
  {
    id: "support-in-app",
    milestone: "launch",
    kind: "publish",
    title: "Show the support email inside the app",
    why: "A buyer whose key didn't arrive has to be able to find you from the app itself.",
    cost: "Free",
    steps: [
      "Ask Claude: “add support@yourdomain to Settings → Help and to the licence screen”.",
      "Release a new version.",
    ],
    verify: ["Settings in the released app shows the address as a mailto link."],
    async check(ctx) {
      if (!ctx.site) return { status: "fail", detail: "Type your domain into “Your website” at the top of this tab first." };
      const host = new URL(ctx.site).hostname.replace(/^www\./, "");
      const { stdout } = await run("git", ["grep", "-l", "-F", `@${host}`, "--", "src", "electron"], {
        cwd: ctx.repo ?? ".",
        allowFailure: true,
      });
      const files = stdout.trim().split("\n").filter(Boolean);
      return files.length
        ? { status: "pass", detail: `@${host} appears in ${files.join(", ")}.` }
        : { status: "fail", detail: `No @${host} address anywhere in src/ or electron/.` };
    },
  },
  {
    id: "release-all",
    milestone: "launch",
    kind: "publish",
    title: "The latest release is published for Mac (Apple silicon + Intel) and Windows (x64 + ARM)",
    why: "The app's update check and the website's download buttons both point at the newest GitHub release.",
    cost: "Free",
    steps: [
      "Bump the version, git tag vX.Y.Z, git push --tags.",
      `Wait for the Release workflow (gh run list -R ${REPO}).`,
      "gh release edit vX.Y.Z --draft=false",
    ],
    verify: [`github.com/${REPO}/releases shows it as Latest with .dmg and .exe files.`],
    async check(ctx) {
      const release = await ctx.latestRelease();
      if (release.isDraft) return { status: "fail", detail: `${release.tagName} is still a draft.` };
      const names = release.assets.map((a) => a.name);
      const want = [
        ["Mac Apple silicon", /arm64\.dmg$/],
        ["Mac Intel", /x64\.dmg$/],
        ["Windows x64", /Setup-.*-x64\.exe$/],
        ["Windows ARM", /Setup-.*-arm64\.exe$/],
      ];
      const gone = want.filter(([, re]) => !names.some((n) => re.test(n))).map(([label]) => label);
      return gone.length
        ? { status: "fail", detail: `${release.tagName} is missing: ${gone.join(", ")}.` }
        : { status: "pass", detail: `${release.tagName} has all four downloads.` };
    },
  },
  {
    id: "key-backup",
    milestone: "launch",
    kind: "set up",
    title: "Back up the licence signing key somewhere offline",
    why: "Lose .license-private-key.pem and you can never mint a key the existing apps accept.",
    cost: "Free",
    steps: [
      "Copy .license-private-key.pem (in the repository folder) into a password manager as a secure note or file attachment.",
      "Optionally also to an encrypted USB stick kept at home.",
      "Never email it, put it in git, or in a cloud drive folder that syncs unencrypted.",
    ],
    verify: [
      "shasum -a 256 .license-private-key.pem — and the same command on the restored copy — print the same value.",
    ],
  },

  /* ------------------------------------------------ 2 · First customers */
  {
    id: "mac-signing",
    milestone: "first",
    kind: "buy",
    title: "Apple Developer Program: sign and notarize the Mac app",
    why: "Unsigned, macOS says the app “can't be opened” and most buyers give up there.",
    cost: "$99 / year",
    steps: [
      "developer.apple.com/programs → Enroll (individual is fine; takes 1–2 days).",
      "Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority → save to disk.",
      "developer.apple.com/account → Certificates → + → Developer ID Application → upload that request → download and double-click the certificate.",
      "Keychain Access → My Certificates → right-click “Developer ID Application: …” → Export → .p12 with a password.",
      `base64 -i cert.p12 | gh secret set CSC_LINK -R ${REPO}`,
      `gh secret set CSC_KEY_PASSWORD -R ${REPO} (the .p12 password)`,
      "appleid.apple.com → Sign-In and Security → App-Specific Passwords → generate one.",
      `gh secret set APPLE_ID -R ${REPO} (your Apple ID email); gh secret set APPLE_APP_SPECIFIC_PASSWORD; gh secret set APPLE_TEAM_ID (developer.apple.com/account → Membership details).`,
      "Ask Claude: “turn on Mac signing and notarization in release.yml and package.json (hardened runtime + entitlements for the native modules)”.",
      "Release a new version.",
    ],
    verify: [
      "Install the new DMG, then: spctl -a -vv \"/Applications/Megan Study.app\" → “source=Notarized Developer ID”.",
      "The first launch shows no “unidentified developer” warning.",
    ],
    async check(ctx) {
      const secrets = await ctx.secrets();
      const gap = missing(
        secrets,
        ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
        "GitHub secrets",
      );
      if (gap) return { status: "fail", detail: gap };
      if (!ctx.readRepo(".github/workflows/release.yml").includes("APPLE_ID")) {
        return { status: "fail", detail: "Secrets are there, but release.yml doesn't pass them to the Mac builds yet." };
      }
      const app = "/Applications/Megan Study.app";
      if (process.platform === "darwin" && fs.existsSync(app)) {
        const { stderr } = await run("spctl", ["-a", "-vv", app], { allowFailure: true });
        if (!/Notarized Developer ID/.test(stderr)) {
          return { status: "fail", detail: `CI is set up, but the installed app isn't notarized: ${stderr.trim().split("\n").slice(0, 2).join(" ")}. Install the newest release and check again.` };
        }
        return { status: "pass", detail: "Secrets set, release.yml uses them, and the installed app is notarized." };
      }
      return { status: "pass", detail: "Secrets set and release.yml uses them. (Install the app to also check the notarization.)" };
    },
  },
  {
    id: "win-signing",
    milestone: "first",
    kind: "buy",
    title: "Sign the Windows installer (Azure Trusted Signing)",
    why: "Unsigned, SmartScreen shows “Windows protected your PC” with the Run button hidden.",
    cost: "≈ $10 / month",
    steps: [
      "portal.azure.com → create a Trusted Signing account (search “Trusted Signing”), Basic tier.",
      "In it: Identity validation → New → Individual (or Organization) → finish the ID check (a few days).",
      "Certificate profiles → + → Public Trust, linked to that validation.",
      "Microsoft Entra ID → App registrations → New → note the tenant and client ids → Certificates & secrets → New client secret.",
      "On the Trusted Signing account → Access control → add role “Trusted Signing Certificate Profile Signer” for that app.",
      `gh secret set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET -R ${REPO}`,
      "Ask Claude: “turn on Azure Trusted Signing for the Windows builds” (package.json win.azureSignOptions with your endpoint, account and profile names; env in release.yml).",
      "Release a new version.",
    ],
    verify: [
      "On Windows, right-click the installer → Properties → Digital Signatures lists your name.",
      "PowerShell: Get-AuthenticodeSignature .\\MeganStudy-Setup-*.exe → Status Valid.",
    ],
    async check(ctx) {
      const secrets = await ctx.secrets();
      const gap = missing(secrets, ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"], "GitHub secrets");
      if (gap) return { status: "fail", detail: gap };
      if (!ctx.readRepo("package.json").includes("azureSignOptions")) {
        return { status: "fail", detail: "Secrets are there, but package.json has no win.azureSignOptions yet." };
      }
      return {
        status: "manual",
        detail: "Set up in CI. Whether the installer is actually signed can only be seen on Windows — follow “How to verify”.",
      };
    },
  },
  {
    id: "uptime",
    milestone: "first",
    kind: "set up",
    title: "Get alerted when the licensing server is down",
    why: "If /status or the webhook fails, buyers pay and get nothing — you should hear first.",
    cost: "Free (UptimeRobot, 5-minute checks)",
    steps: [
      "uptimerobot.com → sign up → Add New Monitor → Keyword.",
      "URL: <worker>/status, keyword: mode, alert when it does not exist.",
      "Alert contact: your email (and the phone app for push).",
    ],
    verify: ["The monitor shows Up; its “Send test notification” reaches you."],
  },
  {
    id: "ledger-backup",
    milestone: "first",
    kind: "set up",
    title: "Every sale is backed up in this manager's ledger",
    why: "Keys minted by Stripe live only in Cloudflare KV until pulled here; the ledger is your copy.",
    cost: "Free",
    steps: [
      "Licences tab → Pull purchases (it also runs when this app opens).",
      "Keep licenses.json in your regular backups (Time Machine covers it).",
    ],
    verify: ["The Licences tab lists every sale shown in Stripe → Payments."],
    async check(ctx) {
      const purchases = await ctx.purchases();
      const have = new Set(ctx.ledger().map((r) => r.id));
      const gone = purchases.filter((p) => p.licenseId && !have.has(p.licenseId));
      return gone.length
        ? { status: "fail", detail: `${plural(gone.length, "sale")} not in the ledger yet — press Pull purchases on the Licences tab.` }
        : { status: "pass", detail: `All ${plural(purchases.length, "sale")} are in the ledger.` };
    },
  },
  {
    id: "sales-tax",
    milestone: "first",
    kind: "set up",
    title: "Decide how sales tax / VAT is handled",
    why: "Many US states tax software downloads, and the EU and UK expect VAT on digital sales to consumers from the first sale.",
    cost: "Stripe Tax 0.5% per sale, or a merchant of record (Lemon Squeezy / Paddle ≈ 5% + 50¢) that files it for you",
    steps: [
      "Simplest: Stripe → Tax → Get started → turn on Stripe Tax and “Automatic tax” on the Payment Link. It calculates and collects; it also shows when you pass a state's registration threshold (Tax → Registrations → Monitoring).",
      "Register where Stripe says you've crossed a threshold, and add those registrations in Stripe.",
      "Or move checkout to a merchant of record, which registers and files everywhere for you.",
      "Talk to an accountant once — this is general information, not tax advice.",
    ],
    verify: ["Payment Links → your link shows “Tax: automatic”; a test checkout shows a tax line for a taxable address."],
  },
  {
    id: "announce",
    milestone: "first",
    kind: "send",
    title: "Send out the launch announcement",
    why: "Word of mouth among students is the cheapest growth there is.",
    cost: "Free",
    steps: [
      "Write one short post: what it does, a 20-second screen recording, the price, the free trial, the website link.",
      "Post it where your students already are: class group chats, the school subreddit, Discord servers, study-tips communities.",
      "Ask your first 5 users for a one-line quote you can put on the website.",
    ],
    verify: ["Usage tab → “new this week” goes up in the days after posting."],
  },

  /* ------------------------------------------------ 3 · Growing */
  {
    id: "workers-paid",
    milestone: "growing",
    kind: "buy",
    title: "Upgrade Cloudflare to Workers Paid",
    why: "The free tier allows 1,000 KV writes a day. Each daily user writes ~7 (usage reports), so around 140 daily users telemetry and purchases start failing.",
    cost: "$5 / month (10M requests and 1M KV writes a month included)",
    steps: [
      "dash.cloudflare.com → Workers & Pages → Plans (or Overview → “Upgrade”).",
      "Choose Workers Paid → add a card → Purchase.",
      "Nothing to redeploy — the Worker gets the new limits straight away.",
    ],
    verify: [
      "Workers & Pages → Plans shows “Workers Paid” as your current plan.",
      "Account → Billing → Subscriptions lists Workers Paid at $5.00.",
    ],
    async check(ctx) {
      const stats = await ctx.stats();
      const daily = dailyFromWeekly(stats.active7);
      const writes = daily * KV_WRITES_PER_DAILY_USER;
      const load = `${plural(stats.active7, "weekly active")} ≈ ${plural(daily, "daily user")} ≈ ${writes.toLocaleString()} KV writes/day of the free 1,000.`;
      if (writes < 500) return { status: "not-yet", detail: `Not needed yet: ${load} Upgrade at about 500/day.` };
      return {
        status: "manual",
        detail: `Needed now: ${load} Cloudflare's plan can't be read from here — upgrade, then confirm below.`,
      };
    },
  },
  {
    id: "email-provider",
    milestone: "growing",
    kind: "buy",
    title: "Email each buyer their key (email provider)",
    why: "When the app's automatic delivery misses, the buyer has only the success page; an emailed key saves a support request per miss.",
    cost: "Free up to 3,000 emails/month (Resend), then $20/month",
    steps: [
      "resend.com → sign up → Domains → add your domain → add the DNS records it shows in Cloudflare.",
      "API Keys → create one → cd workers/licensing && npx wrangler secret put RESEND_API_KEY",
      "Ask Claude: “email the licence key from the Worker after a purchase using Resend”.",
      "npx wrangler deploy",
    ],
    verify: ["Make a purchase (then refund it): the email with the key arrives, not in spam."],
    async check(ctx) {
      const have = await ctx.workerSecrets();
      if (!have.has("RESEND_API_KEY")) return { status: "fail", detail: "RESEND_API_KEY is not set on the Worker." };
      return { status: "manual", detail: "The key is set. Whether mail arrives can only be checked by buying — see “How to verify”." };
    },
  },
  {
    id: "rotate-admin",
    milestone: "growing",
    kind: "set up",
    title: "Rotate the admin token",
    why: "It has been pasted into terminals and settings; replace it once a year or whenever it may have leaked.",
    cost: "Free",
    steps: [
      "openssl rand -hex 32",
      "cd workers/licensing && npx wrangler secret put ADMIN_TOKEN_NEXT (paste it)",
      "Usage tab → Connection → paste the new token → Save → Refresh works.",
      "npx wrangler secret put ADMIN_TOKEN (same new value)",
      "npx wrangler secret delete ADMIN_TOKEN_NEXT",
    ],
    verify: ["Usage tab → Refresh still loads; the old token now gets 401."],
  },

  /* ------------------------------------------------ 4 · A real business */
  {
    id: "llc",
    milestone: "business",
    kind: "buy",
    title: "Form an LLC and get an EIN",
    why: "Keeps a refund dispute or lawsuit from reaching your personal savings, and gives you a business tax id.",
    cost: "$50–$500 state fee (depends on the state) + possible yearly fee",
    steps: [
      "Your state's Secretary of State website → form an LLC (or use a filing service).",
      "irs.gov → Apply for an EIN online (free, minutes).",
      "Stripe → Settings → Business → Account details → change the business type to the LLC and the EIN.",
    ],
    verify: ["You have the state's approval letter and the IRS EIN confirmation (CP 575); Stripe shows the LLC."],
  },
  {
    id: "bank",
    milestone: "business",
    kind: "set up",
    title: "Open a business bank account and move Stripe payouts to it",
    why: "Mixing business and personal money undoes the LLC's protection and makes taxes painful.",
    cost: "Free (Mercury, Relay, most local banks)",
    steps: ["Open the account with the LLC documents and EIN.", "Stripe → Settings → Payouts → change the bank account."],
    verify: ["The next Stripe payout lands in the business account."],
  },
  {
    id: "books",
    milestone: "business",
    kind: "set up",
    title: "Bookkeeping and quarterly estimated taxes",
    why: "Stripe does not withhold income tax; the IRS expects quarterly payments once you owe more than $1,000 a year.",
    cost: "Free (a spreadsheet) to ≈ $30/month (QuickBooks, Wave)",
    steps: [
      "Record every sale (Stripe → Reports) and every cost: Apple $99, Cloudflare, Azure, domain, email.",
      "Pay estimates at irs.gov/payments (Direct Pay) in April, June, September and January.",
      "Keep the 1099-K Stripe sends each January.",
    ],
    verify: ["You can say this year's revenue, costs and taxes paid without looking anything up."],
  },

  /* ------------------------------------------------ 5 · Scale */
  {
    id: "requests-headroom",
    milestone: "scale",
    kind: "watch",
    title: "Worker request volume",
    why: "Every open app asks /status every 2 minutes. Workers Paid includes 10M requests a month; past that it's $0.30 per million.",
    cost: "$0.30 per extra million requests",
    steps: [
      "If this says it's close: ask Claude to slow the status poll (e.g. every 5 minutes) or cache /status at the edge.",
      "Cloudflare → Workers & Pages → study-app-licensing → Metrics shows the real numbers.",
    ],
    verify: ["Metrics → Requests for the last 30 days is under 10M."],
    async check(ctx) {
      const stats = await ctx.stats();
      const monthly = dailyFromWeekly(stats.active7) * REQUESTS_PER_DAILY_USER * 30;
      const share = Math.round((monthly / 10_000_000) * 100);
      const detail = `≈ ${monthly.toLocaleString()} requests/month, ${share}% of the 10M included.`;
      return share < 70 ? { status: "not-yet", detail: `Fine: ${detail}` } : { status: "manual", detail: `Getting close: ${detail}` };
    },
  },
  {
    id: "telemetry-store",
    milestone: "scale",
    kind: "watch",
    title: "Move usage reports off KV",
    why: "Past 1M KV writes a month it costs $5 per extra million, and /admin/stats reads every record.",
    cost: "Workers Analytics Engine or D1 — included in Workers Paid at this size",
    steps: ["Ask Claude: “move telemetry from KV to D1 and compute /admin/stats with SQL”.", "npx wrangler deploy"],
    verify: ["Cloudflare → KV → LICENSES → Metrics: writes per day drop to a handful."],
    async check(ctx) {
      const stats = await ctx.stats();
      const monthly = dailyFromWeekly(stats.active7) * KV_WRITES_PER_DAILY_USER * 30;
      const share = Math.round((monthly / 1_000_000) * 100);
      const detail = `≈ ${monthly.toLocaleString()} KV writes/month, ${share}% of the 1M included.`;
      return share < 70 ? { status: "not-yet", detail: `Fine: ${detail}` } : { status: "manual", detail: `Time to move: ${detail}` };
    },
  },
  {
    id: "help-desk",
    milestone: "scale",
    kind: "set up",
    title: "A help page and a shared support inbox",
    why: "At a few thousand users the same five questions arrive every day.",
    cost: "Free (a FAQ page) to ≈ $20/month (Help Scout, Front)",
    steps: [
      "Collect the questions you answer most (lost key, new computer, refund, which AI key) into yourdomain/help.",
      "Link it from Settings in the app and from the Stripe receipt (Settings → Emails → customer emails → add the link).",
    ],
    verify: ["Support emails per week drop after it's up."],
  },
];

/* ------------------------------------------------------------------- IPC */

async function runCheck(item, ctx) {
  if (!item.check) return { status: "manual", detail: "" };
  try {
    return await item.check(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", detail: `Couldn't check automatically: ${message}` };
  }
}

async function metrics(context, state) {
  const ctx = makeContext(context, state);
  const [stats, purchases] = await Promise.allSettled([ctx.stats(), ctx.purchases()]);
  return {
    active7: stats.status === "fulfilled" ? stats.value.active7 : null,
    installs: stats.status === "fulfilled" ? stats.value.installs : null,
    sales: purchases.status === "fulfilled" ? purchases.value.filter((p) => !p.revoked).length : null,
    error: stats.status === "rejected" ? String(stats.reason?.message ?? stats.reason) : null,
  };
}

function view(state) {
  return {
    site: state.site,
    milestones: MILESTONES,
    items: ITEMS.map(({ check, ...item }) => ({
      ...item,
      auto: Boolean(check),
      saved: state.items[item.id] ?? null,
    })),
  };
}

/**
 * @param {import("electron").IpcMain} ipcMain
 * @param {{configDir?: string, getRoot?: () => string, readLicenses?: () => object[]}} context
 */
function registerScaling(ipcMain, context) {
  const dir = context.configDir;
  const wrap = (fn) => async (...args) => {
    if (!dir) return { ok: false, error: "No settings folder." };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  ipcMain.handle("scaling:list", wrap(() => view(readState(dir))));
  ipcMain.handle("scaling:metrics", wrap(() => metrics(context, readState(dir))));

  ipcMain.handle(
    "scaling:set-site",
    wrap((_event, site) => {
      let value = String(site ?? "").trim();
      if (value && !/^https?:\/\//.test(value)) value = `https://${value}`;
      if (value) new URL(value); // throws on nonsense
      const state = readState(dir);
      state.site = value.replace(/\/+$/, "");
      writeState(dir, state);
      return view(state);
    }),
  );

  /** Runs one item's check (or all automatic ones); a pass marks it done. */
  ipcMain.handle(
    "scaling:check",
    wrap(async (_event, ids) => {
      const state = readState(dir);
      const ctx = makeContext(context, state);
      const wanted = Array.isArray(ids) ? ids : ITEMS.filter((i) => i.check).map((i) => i.id);
      const results = {};
      for (const item of ITEMS.filter((i) => wanted.includes(i.id))) {
        const result = await runCheck(item, ctx);
        results[item.id] = result;
        const previous = state.items[item.id];
        if (result.status === "pass") {
          state.items[item.id] = { done: true, at: Date.now(), how: "auto", detail: result.detail };
        } else if (result.status === "fail" && previous?.how === "auto") {
          // Verified before, not any more: say so rather than keep a stale tick.
          state.items[item.id] = { done: false, at: Date.now(), how: "auto", detail: result.detail };
        }
      }
      writeState(dir, state);
      return { results, ...view(state) };
    }),
  );

  /** For items nothing here can see: the developer's word that it's done (or undone). */
  ipcMain.handle(
    "scaling:mark",
    wrap((_event, id, done) => {
      if (!ITEMS.some((i) => i.id === id)) throw new Error("Unknown item.");
      const state = readState(dir);
      if (done) state.items[id] = { done: true, at: Date.now(), how: "manual" };
      else delete state.items[id];
      writeState(dir, state);
      return view(state);
    }),
  );
}

module.exports = { registerScaling, findRepo, run, ITEMS, MILESTONES };
