# EMRADAR Marketing

Agentic marketing and distribution engine for EMRADAR.

## Operating loop

`SCAN → FORMATION → CAMPAIGN → SCOUT → DESTINATION_BASELINE → EMRADAR_DELTA → NOVELTY_GATE → ROUTE → ADAPT → PERMISSION_GATE → EXECUTE → RECEIPT → OBSERVE → LEARN → DISTRIBUTION_MAP → LOOP`

### Hard rules

- EMRADAR remains the intelligence source of truth.
- Preserve source signal states; marketing cannot promote FORMING to CONFIRMED or erase UNKNOWN.
- Reuse the persistent Distribution Map before external discovery.
- Search only enough to resolve a route decision or evidence gap.
- A relevant destination is not sufficient. Establish its current conversation baseline.
- No insertion without a meaningful EMRADAR delta.
- `NO_MEANINGFUL_DELTA → DO_NOT_INSERT`.
- Adapt to the destination's native interaction; an advertisement is only one insertion type.
- Permission, identity, evidence and risk gates precede execution.
- Every external action requires a receipt.
- Every result, rejection and failure feeds the learning loop.
- Retire reusable routes and hypotheses; do not silently discard them.

## Architecture

See `graph/marketing-graph-v1.json`.

Campaign 002 is the first live integration test. Its first external email exposed the missing novelty gate and is retained as a regression case rather than hidden.
