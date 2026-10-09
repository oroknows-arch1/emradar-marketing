# EMRADAR Marketing Engine V2 cutover manifest

Status: design only. No production cutover, deletion, trigger change, credential change, or external distribution is authorised by this file.

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

## Activation sequence

1. Freeze new V1 intake; do not delete V1.
2. Snapshot and verify historical record counts and hashes, including ambiguous/in-flight receipts.
3. Run the V2 targeted suite with mocked delivery, then one non-delivering production configuration/authentication check.
4. Wire V2 to the existing persistent store and existing approved email transport without copying credentials.
5. Enable exactly one V2 scheduler while V1 triggers remain disabled.
6. Process one published scan only through OWNER REVIEW; verify exact asset/hash binding and zero external actions.
7. With separate owner approval, release one approved destination and verify the persisted provider receipt and duplicate suppression.
8. Verify reply collection/feedback re-entry or record it as unavailable; never infer publication from submission.
9. Remove V1 operational routes, triggers, recovery machinery, and obsolete dependencies. Keep historical readers and records.

## Stop conditions

- Any historical hash/count mismatch, unclassified V1 in-flight/ambiguous action, missing persistent-store compatibility, email relay identity mismatch, unknown chargeable spend, failed duplicate check, or asset/review hash mismatch stops cutover.
- Any V2 and V1 scheduler overlap stops cutover. There is no permanent V1 fallback or parallel-engine state.
