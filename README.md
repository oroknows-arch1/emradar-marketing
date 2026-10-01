# EMRADAR Marketing

Agentic marketing and distribution engine for EMRADAR.

## Operating loop

`SCAN/T0 NARRATIVE → FORMATION + EMRADAR_DELTA → CAMPAIGN PREP (PARALLEL) → DESTINATION_BASELINE (ONLY IF NEEDED) → NOVELTY_GATE → ROUTE → EDITORIAL_INTELLIGENCE → EDITORIAL_QUALITY_GATE → ADAPT → PERMISSION_GATE → EXECUTE → RECEIPT → OBSERVE → LEARN → DISTRIBUTION_MAP → LOOP`

### Hard rules

- EMRADAR remains the intelligence source of truth.
- Preserve source signal states; marketing cannot promote FORMING to CONFIRMED or erase UNKNOWN.
- Reuse the persistent Distribution Map before external discovery.
- Reuse EMRADAR's T0 public-narrative research first; search only enough to resolve a destination-specific route decision or evidence gap.
- Marketing preparation may run in parallel with the scan; external distribution waits for the final EMRADAR evidence/state gate.
- T+ narrative tracking belongs to EMRADAR learning and never blocks Marketing.
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
