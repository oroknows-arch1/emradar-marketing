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
