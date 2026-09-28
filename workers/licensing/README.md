# Licensing Worker

Turns a Stripe payment into a Megan Study license. The app opens a Stripe
Payment Link ($24.95, one-time) with this machine's id as
`client_reference_id`. When the checkout is paid, Stripe calls this Worker,
which mints a `lifetime` Ed25519 key bound to that machine and keeps it in KV.
The app picks it up by polling `GET /license/:machineId`, verifies the
signature itself, and unlocks. The same key is shown on `/success` in case
automatic delivery does not happen.

| Route | Who calls it | What it does |
| --- | --- | --- |
| `POST /stripe/webhook` | Stripe | Verifies the signature; on `checkout.session.completed` (or `async_payment_succeeded`) with `payment_status: paid`, mints once per session. On `charge.refunded` (full refunds only) or `charge.dispute.created`, revokes that purchase's key |
| `GET /license/:machineId` | The app | `{ token }`, or 404 until the webhook has landed |
| `GET /success?session_id=…` | The buyer's browser | Shows the key; refreshes itself until it exists |
| `GET /revoked/:licenseId` | The app | `{ revoked }` |
| `GET /latest` | The app | Newest GitHub release: `{ version, tag, url, publishedAt, assets: [{ name, url }] }`, cached ~10 min; a stale copy if GitHub is down |
| `GET /config` | The app | Remote model defaults (`{ models: { gemini, geminiBulk, geminiPrimer, anthropic, openai } }`, any may be missing), or `{}`; cacheable 10 min |
| `POST /telemetry` | The app | An install's running totals, about hourly; unchanged reports are not rewritten |
| `DELETE /telemetry/:installId` | The app's Settings | Erases that install's record (GDPR); `{ ok: true }` even if there was none |
| `POST /feedback` | The app's Settings | A suggestion |
| `GET /admin/stats` | License Manager | Totals across installs, cached ~10 min; `?fresh=1` recomputes |
| `GET /admin/feedback`, `DELETE /admin/feedback/:key` | License Manager | Suggestions |
| `GET /admin/purchases` | License Manager | Keys minted here: `{ token, licenseId, email, issuedAt, revoked }` (`revoked`: by a refund, dispute or reissue) |
| `PUT /admin/revocations` | License Manager | Replaces the manager's revoked-id list |
| `PUT /admin/config` | Developer | Sets `/config`; unknown slots and odd model ids are dropped; returns what was stored |
| `POST /admin/reissue` | Developer | `{ licenseId or sessionId, machineId }` → a new key for the new machine; the old one is revoked |

`/admin/*` needs `Authorization: Bearer <ADMIN_TOKEN>` (or `ADMIN_TOKEN_NEXT`).

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
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded` and `charge.dispute.created`.
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
| `ADMIN_TOKEN` (and `ADMIN_TOKEN_NEXT` while rotating) | `wrangler secret`, and the License Manager's settings | in git, in the app |
| Stripe secret key (`sk_…`) | not needed here | — |

The Worker only verifies webhooks and signs keys, so it never calls Stripe's
API and needs no `sk_` key. For local runs, copy `.dev.vars.example` to
`.dev.vars` (gitignored) and use `stripe listen --forward-to
localhost:8787/stripe/webhook`, which prints a `whsec_` for the session.

### Rotating ADMIN_TOKEN

Either token is accepted, so nothing is locked out mid-way:

1. `openssl rand -hex 32`, then `npx wrangler secret put ADMIN_TOKEN_NEXT` with it.
2. Put the new token in the License Manager's settings and check it still loads stats.
3. `npx wrangler secret put ADMIN_TOKEN` with the same new value.
4. `npx wrangler secret delete ADMIN_TOKEN_NEXT`. The old token now fails.

### Refunds, disputes, reissues

Each checkout also stores `pi:<payment_intent>` → session, which is how a
refund or dispute (they name only the payment) finds the key. A full refund
or any dispute revokes it; partial refunds do not. Purchases minted before
this was added have no `pi:` entry and are revoked by hand in the License
Manager.

These revocations — and the old key on a reissue — go in a separate list,
`revoked:auto`, which `GET /revoked/:id` checks alongside the manager's.
The manager's `PUT /admin/revocations` replaces its own list wholesale from
its ledger, so anything added to that one here would be undone on its next
push. They show as `revoked: true` in `/admin/purchases`; to restore one,
edit `revoked:auto` with `wrangler kv key put`.

A buyer on a new computer:

```sh
curl -X POST https://study-app-licensing.<you>.workers.dev/admin/reissue \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"licenseId":"<old id>","machineId":"<new machine id>"}'
```

returns `{ token, licenseId, revoked }`. The new key keeps the buyer's name
and email, replaces the purchase's `session:` record (so a later refund
revokes the new key), is served from `/license/<new machine>`, and the old
key is revoked. Letting buyers do this themselves would need proof they own
the purchase — a code emailed to the checkout address — and so an email
provider, which this Worker does not have.

### What this does not do

- **Email the key.** Stripe's receipt cannot carry it. Delivery is the app's
  poll plus the success page; email needs a mail provider (Resend, Postmark).
- **Keep your local ledger in step.** Keys minted here live in KV, not in
  `licenses.json`. `wrangler kv key list --binding LICENSES` lists them.
- **Handle a checkout opened outside the app.** With no machine id there is
  nothing to bind to; the webhook logs it and you mint by hand:
  `node scripts/mint-license.mjs --type lifetime --machine <id>`.
