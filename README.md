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

## Executable closed loop

`runtime/graph.js` binds the existing graph nodes to bounded workers and follows
explicit success/blocked/duplicate edges. The source contract stays authoritative.
The verified X OAuth/media publisher is reused through `runtime/adapters.js`.
`/RUN_MARKETING` now enters the graph; there is no parallel direct-publication path.
Request-body PASS strings are no longer permission to publish.

- Production state/receipts/holds/cost reservations: Redis via `KEY_VALUE_URL`.
- Safe test state: atomic files and exclusive locks; actual file publication/read-back.
- Learning: execution reliability, failure/cooldown history, native measurements,
  bounded measurement effects and approved variant preferences. Routing, relevance,
  signal priority, and format/variant selection consume persisted learning next run.
- Local delivery measurements affect local reliability only. They are not audience
  engagement. X public metrics retain their names, units and channel scope.
- Later measurements update learning without counting a publication twice.
- All X API billing remains UNKNOWN until verified. Organic ad spend is separate.

Run `npm test` and `npm run test:loop`. Concrete two-cycle evidence and the duplicate
check are committed in `tests/evidence/closed-loop.json`.

## Activation contract

See `contracts/autonomous-runtime.md`. Deploy this change after preparing the trusted
product package and executor token. Existing X authorization keys and EMRADAR's
legacy authorization fallback remain supported. This branch does not deploy itself.

Source-approved extractive copy and a deterministic SVG test format work without
model calls. X supports reviewed image bytes or approved short text. Missing novel
copy, destination research, or image review is an explicit bounded Harness-required
blocker; the engine never silently substitutes an unreviewed model or weakens a gate.
The existing VC Harness contract remains the sole owner of provider/model routing.

Signed `/PRODUCT_INPUT` now persists source revisions without granting marketing
permissions. `runtime/intake.js` translates native EMRADAR scans, preserving
uncertainty. Source-bound templates can manufacture copy from facts; the configured
Harness bridge handles verified creation/discovery with bounded cost reservations.
`/CYCLE` permits an authorized external scheduler. Observation re-entry follows the
same executable graph edges. See the activation contract for the genuine deployment,
source signing, runtime and financial prerequisites.
