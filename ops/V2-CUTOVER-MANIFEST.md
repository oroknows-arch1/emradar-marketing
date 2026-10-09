# EMRADAR Marketing Engine V2 cutover manifest

Status: code-integrated, inactive, and awaiting production cutover authority. No production cutover, deletion, trigger change, credential change, or external distribution is authorised by this file.

## Preserve before activation

- All October 7, 8, and 9 campaign records, source revisions, evidence, assets, decisions, review and delivery hashes, provider receipts, publication records, and outcomes remain read-only.
- Preserve the existing Purelymail configuration, mailboxes, domain, sender/reply-to identity, credentials, and the paid `orok-studios-api` service and deployment configuration unchanged.
- Import no historical repair workflow. V2 reads existing `receipt:<delivery_key>` identifiers only as immutable duplicate-prevention evidence.

## V1 execution components to retire after V2 verification

- Disable V1 scheduler and autonomous intake triggers before enabling the V2 scheduler.
- Remove V1 graph execution, campaign recovery/repair entry points, legacy proposal regeneration, legacy distribution drains, and obsolete owner-override controls from the operational route table.
- Remove V1-only scheduled observation/retry triggers after every in-flight or ambiguous action has a terminal owner-reviewed disposition.
- Retain shared durable store, authenticated published-scan intake contract, approved email adapter/relay contract, spending controls, provider receipts, and immutable historical readers.

## Required compatibility boundary

- V2 must use the existing persistent store and recognise both `receipt:<delivery_key>` and `v2:receipt:<delivery_key>` before any external action.
- The email adapter remains an injected implementation of `quote(asset)` and `send({asset,idempotency_key,approval})`; production wiring must use the existing authorised Purelymail-compatible `orok-studios-api` path.
- Campaign and calendar-month limits remain AUD 5 and AUD 50. Unknown chargeable spend stops for owner authority.
- `MARKETING_V2_ENABLED` must be exactly `true` before any V2 server route can instantiate the runtime. Leave it unset during build verification.
- `MARKETING_V2_INTEGRATION_MODULE` must resolve to the reviewed destination catalogue and `assetBuilder`; `MARKETING_EDITORIAL_OUTREACH_MODULE` remains the existing approved email module.
- `/V2/PUBLICATION_REVIEW` uses `MARKETING_PUBLICATION_REVIEW_TOKEN`. `/V2/PREPARE`, `/V2/DISTRIBUTE`, and `/V2/FEEDBACK` use `MARKETING_ENGINE_TOKEN`.
- Owner approval only persists exact-hash work. Distribution remains a separate authenticated action; the review endpoint does not send.

## Exact V1 retirement actions

- Disable the scheduler invoking `normalCycle`, `/CYCLE`, autonomous scan intake, and the V1 approved-distribution drain.
- Remove public routing for `/RUN_MARKETING`, `/COLLECT_PERFORMANCE`, V1 `/PUBLICATION_REVIEW` mutation, recovery endpoints, campaign-launch recovery, and legacy distribution-repair entry points only after the stop checks below pass.
- Retain read-only access required for historical `publication_review:*`, `publication_approval:*`, `receipt:*`, `receipt_history:*`, `review_package:*`, campaign-cost, outcome, and learning records.
- Do not remove `RedisStore`, the editorial adapter loader, sender authentication, paid relay, source verification, spending authority, or provider receipt contracts used by V2.

## Activation sequence

1. Freeze new V1 intake; do not delete V1.
2. Snapshot and verify historical record counts and hashes, including ambiguous/in-flight receipts.
3. Run the V2 targeted suite with mocked delivery, then one non-delivering production configuration/authentication check.
4. Set the existing V2 module and email module paths, retaining credentials in their current environment variables; perform the non-delivering runtime construction check.
5. Enable exactly one V2 scheduler while V1 triggers remain disabled.
6. Process one published scan only through OWNER REVIEW; verify exact asset/hash binding and zero external actions.
7. With separate owner approval, release one approved destination and verify the persisted provider receipt and duplicate suppression.
8. Verify reply collection/feedback re-entry or record it as unavailable; never infer publication from submission.
9. Remove V1 operational routes, triggers, recovery machinery, and obsolete dependencies. Keep historical readers and records.

## Verification conditions before retirement

- Targeted V2 and integration tests pass with simulated delivery, including process restart, owner-auth rejection, exact approval, cross-version historical receipt suppression, and feedback re-entry.
- A production Redis read-only audit confirms October 7–9 record counts and hashes; no history migration is required or permitted.
- Every V1 `IN_FLIGHT` or `AMBIGUOUS` receipt has an explicit disposition. Accepted/submitted historical delivery identifiers are visible to V2 duplicate checks.
- The configured existing editorial module passes authentication/identity verification without sending, and the reviewed V2 module exposes only verified executable routes.
- V1 scheduler is disabled before `MARKETING_V2_ENABLED=true`; exactly one V2 scheduler is then enabled.
- First production preparation stops at owner review with zero external actions. First distribution requires a separately authenticated exact-hash approval and yields a persisted provider receipt.

## Stop conditions

- Any historical hash/count mismatch, unclassified V1 in-flight/ambiguous action, missing persistent-store compatibility, email relay identity mismatch, unknown chargeable spend, failed duplicate check, or asset/review hash mismatch stops cutover.
- Any V2 and V1 scheduler overlap stops cutover. There is no permanent V1 fallback or parallel-engine state.
