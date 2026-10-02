# Autonomous runtime and authority

## Source and activation

`MARKETING_PRODUCTS_FILE` is a trusted server-side JSON map keyed by product identity,
written by the source publishing system or an authorized operator. Neither caller
PASS strings nor learning can alter it. Each package includes:

- `product_identity`, `brand_system`, `uncertainty_state_model`;
- `release_approved` and source `review.evidence/brand/editorial/risk`;
- `signals[]`: id, revision, original state, evidence IDs, reviewed `approved_copy[]`;
- optional `approved_asset`: base64, sha256, reviewed, mime (PNG/JPEG);
- `destinations[]`: id, platform, signal_ids, reviewed formats, bounded relevance;
- each destination's baseline ID/expiry, meaningful delta tied to source revision
  and evidence IDs, and destination permission tied to revision/expiry;
- `autonomous.enabled` to allow the unattended scheduler for that product.

The fixture is an executable schema example, for a local test product only.
It grants no EMRADAR/Atlas/X permission. Source release approval (including Atlas)
remains required. Discovery reuses the registered map; an unresolved gap blocks with
`NO_VERIFIED_DESTINATION_HARNESS_DISCOVERY_REQUIRED`. Creation is extractive from
reviewed product copy. Missing creative authority blocks rather than inventing facts.

Set `MARKETING_ENGINE_TOKEN` for authenticated `/RUN_MARKETING` and
`/COLLECT_PERFORMANCE` calls. Keep it in the service secret store. Requests are
`{product,campaign_id,signal_id?}` or `{receipt_id}`. No raw caller asset/PASS shortcut.

Set `MARKETING_AUTONOMOUS=true` to run bounded scheduler ticks. Default interval
is five minutes, minimum one minute (`MARKETING_CYCLE_INTERVAL_MS`). A tick admits
at most one new approved source revision plus one due receipt observation. It
remembers source-package fingerprints, consumes prior learning, bounds definitive
failure retries to three scheduler attempts, and never automatically retries an
ambiguous publication. A changed source package can resolve a previously blocked
approval/input. Unchanged blocked inputs do not consume model usage indefinitely.

## Financial authority

Local adapter cost is zero. X publishing/reads have UNKNOWN billing here; no live
paid API action was performed in the proof. `ad_spend_usd=0` does not mean API free.

For UNKNOWN-cost APIs the trusted package needs explicit approved numeric bounds:
`budget.approved`, `max_action_usd`, `max_cycle_usd`, `max_daily_usd`,
`max_daily_api_calls`. Each destination declares `max_action_usd`, `max_api_calls`.
Reservations are persisted before action; they are conservative approved estimates,
not claims about billed costs. X image publishing uses up to four calls (initialize,
append, finalize, tweet); text publishing uses one. The owner must confirm applicable
pricing and bounds before activation. The adapter never starts an ad purchase.

Metrics need independent `metrics_approved`, `max_metrics_calls` (daily ceiling),
`max_metrics_action_usd`, `max_metrics_daily_usd`. Missing authority/budget records
UNKNOWN. HTTP errors preserve UNKNOWN and never manufacture impressions or clicks.

## Recovery

Graph state/receipts live under `marketing:graph:*` in Redis, isolated from OAuth.
A shared exclusive Redis lock covers each side effect and state update. It does not
expire automatically: crash recovery is an exception because the last POST may
have succeeded. In-flight receipts and product/signal/revision holds prevent retry
through an alternative format or destination. Check the platform before reconciling
an ambiguous receipt or clearing a stale lock. Never clear it merely to retry.
Platform-wide rate cooldown and circuit breakers prevent alternate-route bypass.

Receipts include destination, platform, variant, format, timestamp, status, external
ID/URL, campaign/product/signal/revision, attempt ceiling, retry/error and actual or
UNKNOWN cost. Every gate rejection has a BLOCKED receipt. Learning changes only its
own routing state, retains native metric scopes, and hashes source truth before/after.

## Verified scope and remaining integration boundary

The checked-in proof is real local delivery/read-back, not synthetic engagement or a
live X trial. The unattended scheduler and two-cycle reuse are tested. Production
Redis and live X metric access must be verified in the hosting environment after
activation; existing OAuth is preserved. The optional Harness-required paths are
explicit blockers because this repository contains a routing contract, not a callable
Harness service. No claim is made that fresh discovery/model creation is connected.

## Signed source handoff and graph workers

`POST /PRODUCT_INPUT` accepts `{product,sequence,source}` with an
`x-product-signature` HMAC-SHA256 over its JSON serialization. Keys are per product
in `MARKETING_SOURCE_KEYS_JSON`; registered owner policy comes from
`MARKETING_PRODUCTS_FILE` or `MARKETING_PRODUCTS_JSON`. Sequences are monotonic;
exact duplicate input is idempotent. Source authority is limited to signals, source
release and evidence/editorial attestations. Input cannot change destination
permission, budgets, autonomous activation or product brand policy.

`runtime/intake.js` exposes `emradarSource` for the native discovery schema. It
preserves source state, causal chain, evolution, facts and uncertainty. No release
approval is inferred from a publicly readable scan. The real snapshot handoff proof
is `tests/evidence/native-source-handoff.json` (`npm run test:native-source`).

Approved extractive templates can generate text from bound source facts without
model usage (`copy_policy.extractive_template_approved`). Missing facts are not
invented. All existing release, evidence, editorial and permission gates still apply.
The native adapter is an engine-side handoff; the product publisher still needs its
registered signing key and a source trigger to call this endpoint.

Owner authority is recorded in `config/owner-authority.json`: automatic release
after signed native `evidence`, `editorial`, `brand`, `risk` and `publication` gates
all say PASS; automatic selection only among connected/approved providers; A$5 per
campaign and A$50 per Sydney-calendar-month hard limits. A source's self-declared
`release_approved` does not override a missing native gate when automatic release is
enabled. It does not turn on `autonomous.enabled` for any product. No native source
publisher trigger is connected yet, so the actual gate attestations remain UNKNOWN.

`runtime/spending.js` holds one shared AUD ledger under the engine lock for workers,
publication and collection. A positive-cost action requires a verified,
provider-enforced upper bound and reconciled monthly billing, then settles an actual
receipt. Unresolved billed cost remains UNKNOWN and blocks further paid actions;
local zero-cost execution can continue. Legacy USD reservations do not prove an AUD
actual-cost bound. The current X adapter has no verified cost quote, so it remains
blocked despite owner approval. Do not mark prior unobserved spending as zero.

`.github/workflows/marketing-cycle.yml` uses public-repo standard GitHub runners
to wake `POST /SCHEDULED_CYCLE` twice hourly, authenticating with a short-lived
GitHub OIDC token restricted to this repository, workflow, default branch, event
and audience. The endpoint safely skips while `MARKETING_AUTONOMOUS` is false.
Scheduled runs may be delayed; the persistent scheduler de-duplicates revisions
and observations. No Render cron/worker resource is added.

## Final publication review

For every non-LOCAL destination, the `publication_review` node is the final owner
gate after the existing automated gates. A run returns `AWAITING_REVIEW` with a
proposal ID and review hash. No destination call occurs. The proposal holds the
exact copy, asset, source state/evidence, destination, format and 24-hour expiry.
Set `MARKETING_PUBLICATION_REVIEW_TOKEN` as a separate owner-only Render secret;
do not give it to the scheduler, source publisher or Harness. The existing engine
token cannot grant this approval.

`GET /PUBLICATION_REVIEW?proposal_id=<id>` with that bearer token returns the full
proposal for owner inspection. `POST /PUBLICATION_REVIEW` with the same bearer token
and `{ "proposal_id": "...", "review_hash": "..." }` records an owner decision and
immediately reruns the graph. All automated gates execute again, and publication
proceeds only if the exact draft still matches. A changed source revision, copy,
destination or product policy produces a new `AWAITING_REVIEW` proposal. Receipt
idempotency prevents a second post from a repeated approval. This is a deliberate
human gate at submission, not recurring approvals throughout preparation.

For fresh discovery/creation, `MARKETING_HARNESS_MODULE` names a trusted deployed
module exporting the canonical Harness `routeWorkUnit`,
`createRuntimeProviderRegistry`, plus `executeMarketingWorkUnit` and
`verifyMarketingWorkUnit` transport wrappers. The existing Harness router remains
responsible for lane/provider selection. Verification binds input/output hashes and
source evidence IDs. Attempts are capped at two, with numeric worker-budget
reservations before dispatch (`creation_approved`/`discovery_approved`,
`max_worker_usd`, `max_worker_daily_usd`, `max_worker_calls`). No configured runtime
means `HARNESS_DISPATCH_NOT_CONNECTED`; the repository contract alone is not a
running model service. Discovered destinations inherit only current owner permission,
including when loaded from cache. Model-created PASS strings confer no authority.

Authenticated `POST /CYCLE` invokes the same bounded scheduler node. This permits
an authorized external scheduler where an in-process timer cannot stay running.
Observation re-entry now traverses graph edges, rather than a hard-coded worker list.

## Live inspection on 2026-10-02 UTC

Workspace: approved `My Workspace` (`tea-d79k6muuk2gs73eesr2g`).
Marketing service: `srv-dav3uj60tbcc73dggrag`, live main commit `0a782880`.
Plan: free web service. Key Value: `emradar-x-auth`, plan `256mb`, available.
Exact account billing and API prices were not exposed and remain UNKNOWN.
Health reported EMRADAR X disconnected and Atlasoquence X connected. This proves
reported availability at inspection time, not that refresh failure/revocation was
independently diagnosed. No reconnect was attempted and no credentials were replaced.
No Harness service appears in the approved workspace's service inventory.
No new paid service, external campaign or API-metrics purchase was created.
