# Licensing Worker

Turns a Stripe payment into a Study App license. The app opens a Stripe
Payment Link ($24.95, one-time) with this machine's id as
`client_reference_id`. When the checkout is paid, Stripe calls this Worker,
which mints a `lifetime` Ed25519 key bound to that machine and keeps it in KV.
The app picks it up by polling `GET /license/:machineId`, verifies the
signature itself, and unlocks. The same key is shown on `/success` in case
automatic delivery does not happen.

| Route | Who calls it | What it does |
| --- | --- | --- |
| `POST /stripe/webhook` | Stripe | Verifies the signature; on `checkout.session.completed` (or `async_payment_succeeded`) with `payment_status: paid`, mints once per session |
| `GET /license/:machineId` | The app | `{ token }`, or 404 until the webhook has landed |
| `GET /success?session_id=…` | The buyer's browser | Shows the key; refreshes itself until it exists |

Tests: `npm test` at the repository root runs `src/worker.test.ts`, which
feeds signed webhook events through this exact file and checks the key that
comes out against the app's own `electron/license/verify.cjs`.

## Deploying

From this directory:

```sh
npm install
npx wrangler login
npx wrangler kv namespace create LICENSES   # paste the id into wrangler.toml
npx wrangler secret put LICENSE_PRIVATE_KEY < ../../.license-private-key.pem
npx wrangler deploy                         # prints https://study-app-licensing.<you>.workers.dev
```

Then, in the Stripe dashboard (test mode first):

1. **Developers → Webhooks → Add endpoint**:
   `https://study-app-licensing.<you>.workers.dev/stripe/webhook`, events
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Copy its signing secret and run `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
2. **Payment Link → After payment → Don't show confirmation page → redirect** to
   `https://study-app-licensing.<you>.workers.dev/success?session_id={CHECKOUT_SESSION_ID}`.
3. Optional: set `PAYMENT_LINK_ID` in `wrangler.toml` to the link's `plink_…`
   id, so no other product in the account can mint a key.

Finally, put the Worker's URL in the app's `.env.local` and rebuild, so
packaged builds know where to collect keys:

```
LICENSE_SERVER_URL=https://study-app-licensing.<you>.workers.dev
```

### Secrets

| Secret | Where it lives | Never |
| --- | --- | --- |
| `LICENSE_PRIVATE_KEY` | `wrangler secret` | in git, in `wrangler.toml`, in the app |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | `wrangler secret` | in git |
| Stripe secret key (`sk_…`) | not needed here | — |

The Worker only verifies webhooks and signs keys, so it never calls Stripe's
API and needs no `sk_` key. For local runs, copy `.dev.vars.example` to
`.dev.vars` (gitignored) and use `stripe listen --forward-to
localhost:8787/stripe/webhook`, which prints a `whsec_` for the session.

### What this does not do

- **Email the key.** Stripe's receipt cannot carry it. Delivery is the app's
  poll plus the success page; email needs a mail provider (Resend, Postmark).
- **Keep your local ledger in step.** Keys minted here live in KV, not in
  `licenses.json`. `wrangler kv key list --binding LICENSES` lists them.
- **Handle a checkout opened outside the app.** With no machine id there is
  nothing to bind to; the webhook logs it and you mint by hand:
  `node scripts/mint-license.mjs --type lifetime --machine <id>`.
