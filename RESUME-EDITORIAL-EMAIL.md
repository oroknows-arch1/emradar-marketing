# Paused again: tested email fix, not deployed

Owner said “Stop and continue” at 2026-10-06 05:00 Australia/Sydney. Wait for the next resume instruction.

Current status:
- Finished draft code is local and saved on fix/editorial-human-email.
- 21 relevant regressions PASS (editorial-email, editorial-costs, editorial-outreach, editorial-outreach-gmail, publication-review).
- Syntax and whitespace checks PASS.
- Same-source preview of the four existing production records compiles successfully: Reuters 97 words; International Mining 159; Australian Mining Review 161; REDIMIN 194.
- Actual four production records were freshly retrieved HTTP 200, still original AWAITING_REVIEW, FORMING, ZERO, no visuals.
- NO main update, deployment, production revision, approval or distribution occurred.
- Main still d693c9ba5b65c6a7c8d927fbd8131ff4d2e9061b, verified immediately before pause.

Resume at DEPLOYMENT, not source discovery or broad testing. First read final code/tests and check for any new changes to main. The relevant tests already passed; rerun only if new edits/failures justify it.

Tested changes since first pause:
- Stable destination/permission bindings and full review context now stored in proposals, recomputed before approval to reject changed subject/body/recipient/assets.
- Approved replay restores exact stored email and localization, without redoing correspondence generation.
- Revisions cannot run without an explicit PUBLICATION_REVIEW stop; old proposals become SUPERSEDED and cannot be approved.
- Model-generated service claims require independently verified complete capability inventory; only a narrowly defined current source-linked note is supported. Ongoing services remain UNVERIFIED/excluded.
- Revised English email reuses native-gated facts and every uncertainty; no model calls in correction. Spanish inherits verified legacy wording/hash and uses bounded uncertainty translations, blocking unknown terms.
- Exact Gmail subject/body/sender envelope is covered by tests; transport no longer changes reviewed subjects.
- New tests cover correction idempotency, source immutability, no sending during correction, old-approval invalidation, changed-source/hash/asset rejection, declared unsupported claims, localization and exact local simulated delivery. All 21 pass.
- Editorial contract extended with correspondence and capability-truth requirements. No unrelated tests run.

Next authorized actions:
1. Save the final code to main using existing GitHub atomic tree/commit/ref update with current main as parent; do not include the old WIP checkpoint in main unless deliberately documenting pause. Direct git push lacks credentials; GitHub connector writes succeeded.
2. Let existing Render auto-deploy trigger. Verify live commit and runtime /health. Render service/workspace IDs below.
3. Use existing review credentials from authorized session context (not source files/checkpoint); do not ask owner to copy secrets or sign in.
4. Retrieve original exact proposals and review hashes (scratch /tmp/<proposal_id>.json contains freshly fetched copies; refetch only if potentially changed).
5. For each, POST /PUBLICATION_REVIEW/revise with ONLY proposal_id and review_hash. This operation cannot approve/send and traverses the reusable graph with a forced review stop. Keep operations sequential because graph lock is shared.
6. Fetch returned new proposal IDs through authenticated GET /PUBLICATION_REVIEW. Check same evidence/revision/source receipt/destination/cost, status AWAITING_REVIEW, capability gate PASS, visual NONE, no external execution.
7. DISPLAY all four corrected production emails exactly, including destination, recipient/route, new proposal ID, subject, complete body, visual NONE, evidence state, capability result, cost and status. STOP immediately after display.

If production revision fails, diagnose that exact bounded path; do not rerun scan/campaign, broaden destinations, approve or send. Current source reuse does not require Harness provider execution, but future fresh campaigns still require their pre-existing verified editorial worker; do not claim its production availability was demonstrated by tests.

Production and repo details retained below. Earlier draft caveats describe the first pause and are superseded by the tested changes above.

# Paused: human-ready email and capability claim gate

Owner said “Stop and resume” at 2026-10-06 04:47 Australia/Sydney. Stop execution until owner resumes.

Repository: oroknows-arch1/emradar-marketing
Branch: fix/editorial-human-email
Base/live main: d693c9ba5b65c6a7c8d927fbd8131ff4d2e9061b
Render: srv-dav3uj60tbcc73dggrag; workspace tea-d79k6muuk2gs73eesr2g
Worktree: /workspace/scratch/431344a963ca/emradar-marketing

Unfinished changes are saved on this branch. No main update, deployment, proposal refresh, approval, external send or source rerun occurred in this task. Production still has the original four AWAITING_REVIEW proposals.

Findings:
- runtime/editorial-copy.js validates an editorial proposition, but lacks the complete human correspondence layer and capability claim validation.
- runtime/editorial-outreach-gmail.js previously prefixed/truncated the subject and sent asset.copy including its Subject line as the body after approval. This violates exact-artifact parity.
- Graph currently uses verified Harness editorial work for future open routes. Its availability was not newly verified; do not assume it exists or manufacture provider verification.

Draft implementation, NOT ready to deploy:
- runtime/editorial-email.js: reusable deterministic correspondence transformation, source-bound bounded offer, capability gate, exact sender/recipient/body validation, English/Spanish reuse of existing propositions.
- graph nodes human_ready_email and capability_claim_gate are inserted after localization and before editorial_quality_gate.
- GraphEngine.revisePublication and authenticated POST /PUBLICATION_REVIEW/revise force review-only correction through the graph and retain SUPERSEDED provenance.
- Sender identity is read from the actual Gmail transport, and delivery uses the exact reviewed subject/body.
- Approved email replay reuses its saved proposition and checks exact artifact equality.

Validation so far: node --check on graph.js and editorial-email.js, git diff --check only. NO regression tests written or run yet. No production changes.

Resume next:
1. Review the unfinished implementation carefully. Verify the restored proposition path does not bypass source/editorial/security gates. All reused source revision, evidence refs, source receipt, verified route and localization must match.
2. Verify capability claims are fail-closed and cannot be smuggled through alternate wording. Do not call untested parsing sufficient semantic proof. Current draft removes first-person ongoing promises and only offers the included source-linked note. No monitoring/continuous coverage promise.
3. Check Reuters actual body is <=100 words and preserves ALL source uncertainty. Current generic full qualification text may exceed the limit; fix without dropping facts/uncertainty or changing source truth.
4. Check Spanish qualification reuse against stored verified localization hash. Current translation terms are generic, but verify language and fact preservation; do not claim localization quality from a regex alone.
5. Check revision and approval hash consistency: permission.valid_until is currently taken from proposal.expires_at on reuse. New expiry differs from original, so exact review hash may change during approval replay. Preserve stable destination binding/permission for replay. Verify idempotency and crash recovery between replacement/new-proposal/superseded writes. Old SUPERSEDED proposals must never be approved or scheduled.
6. Ensure existing approved email replay delivers stored artifact exactly and cannot silently use changed sender/source/route. Protect against post-review asset corruption by checking recomputed review hash, not just stored hash.
7. Add only relevant regression tests for human email, capability gate, source uncertainty/forecast preservation, destination distinction, Spanish, exact subject/body delivery, no send before approval, old review rejection/hash/idempotency. Existing fixtures need an approved sender identity; do not weaken production requirements to make old fixtures pass.
8. Check graph maxSteps and graph metadata/handoffs. Only broaden tests if relevant failures require it.
9. Commit final verified changes; push main through existing mechanism only after relevant tests pass; verify live commit.
10. Retrieve existing four records with previously working exact Authorization: Bearer header. Credentials must remain secret and out of source/checkpoint. Then call the bounded revise route with the current old proposal ID and exact review hash. Do not call approval POST. Retrieve corrected IDs returned by graph and DISPLAY exact production records in full. STOP.

Original IDs:
Reuters: 02b18338cd04cf151887a7121128aa05197e54f69dc6e9f849f5e1d4b4190736
International Mining: 71ca0aa921976f740b36d8bb0dc69560fbc7a3f32bf847633b2334e7cbd0c9ea
Australian Mining Review: 6a1aafed7f690d115b547b98688d3678810700e37fdd1843379d6b4cdb30de78
REDIMIN: 4c0fdfc3f2a18e469e3892e7822107e28463be57e7aedda3dbb9d38106e70d2e

All original records were retrieved HTTP 200 in the previous turn with the existing review token. They are FORMING, ZERO cost, AWAITING_REVIEW, no visuals. Source is the same native-gated Sierra Gorda revision 05f50f4972888c492958c2ea98f8413f7d589cb840480f5880723795714fe84a; source receipt sequence 4/digest c26adf73a741d80bac3d50836a8c2d5cc6bc1706ad35fd7f58e348b210faefa1.

Keep owner boundary: no approve, email send, publication submission, X post, source scan, route expansion, auth weakening or routine signup. Do not manually rewrite four Redis records. Preserve existing graph and feedback loop, permission/evidence/cost gates. Report generation costs separately from ZERO email route cost; unknown costs stay UNKNOWN.
