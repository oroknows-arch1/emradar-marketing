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

Social account readiness and the one-time owner setup record live in
`state/integration-register.json` and `INTEGRATION_REGISTER.md`. This is the
connection source of truth; `state/distribution-map.json` remains route memory.

LinkedIn OAuth uses `/oauth/linkedin/start` and the exact callback path
`/oauth/linkedin/callback`. It requires `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `KEY_VALUE_URL`, `LINKEDIN_ORGANIZATION_URN`, and
`LINKEDIN_API_VERSION`. `LINKEDIN_SCOPES` is optional and defaults to the
least-privilege Share on LinkedIn scopes. Tokens are persisted in the existing
Key Value store and are never returned by the OAuth endpoints.

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

Hosted verification now passes on the existing Render service at commit `dd1ee68`:
real local destination delivery/read-back, Redis receipts and learning, a second
request consuming version 1 and changing its route score, and duplicate prevention.
Exact receipts are in `tests/evidence/hosted-closed-loop.json`; the concise verdict
is `tests/evidence/hosted-loop-summary.json`. The real source handoff blocks at
missing release authority, and an invalid signature is rejected. This demonstrates
the hosted executable feedback loop; it does not release external campaigns.

The next deployment draft records owner authority in `config/owner-authority.json`.
It permits automatic source release only on a signed native attestation of all five
required gates, and requires provider-enforced AUD quotes plus reconciled actual
billing under A$5/campaign and A$50/calendar-month limits. UNKNOWN paid cost blocks;
local zero-cost delivery remains usable. Authority does not opt products into
external campaigns. A GitHub OIDC-authenticated scheduled wake-up is scoped to this
repo's `main` workflow; it skips while `MARKETING_AUTONOMOUS` is disabled. Source
publishers still need an actual native gate event and signed handoff; a deployed
Harness executor and reconciled provider billing remain unavailable. Do not equate
this draft with full autonomous external distribution.

External publication now stops at the `publication_review` graph node after the
evidence, editorial, brand, risk, destination permission and cost gates. The engine
persists an exact draft with its source state, copy, asset, destination and hash,
returns `AWAITING_REVIEW`, and performs no external action. An owner-only approval
for that exact hash resumes execution, receipt, measurement and learning. A changed
asset, route or product truth needs a new review. Local safe tests remain unattended.

Verified public editorial email and submission-form routes use the same graph through
the optional trusted `MARKETING_EDITORIAL_OUTREACH_MODULE`. That module may export
`sendEditorialEmail`, `submitEditorialForm`, `collectEditorialOutcome`,
`editorialRouteAuthorized`, and `editorialRouteSupported`. A reviewed delivery records
`SUBMITTED` rather than pretending the destination published it; subsequent replies and
publication confirmation re-enter observation and learning. If no transport is
configured, preparation still reaches `PUBLICATION_REVIEW`, but the execution deficiency
is recorded as internal and never presented as a new owner-authority decision.

REDIMIN copy passes through a bounded `es-CL` localization worker before the existing
editorial quality gate. The verified translation is source/evidence bound and cached by
source revision, destination, locale, and source copy, so an exact recorded publication
approval resumes without paying for or requesting routine re-localization.
