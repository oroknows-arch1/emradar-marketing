# Owner-authorized X organic discovery dry test

Authority: 4 October 2026 Australia/Sydney. Existing EMRADAR Marketing Engine app,
Default Project (Pay Per Use), existing credits and existing X authorization only.
Maximum USD $1 total; no purchases, billing changes, credential changes or engagement.

Fixed test ID: EMRADAR_X_DISCOVERY_2026_10_03_V0_2.
Source: commit 9429ada7c2f7a59c3b662d077551c46d0d1e5f03,
data/checkpoints/discovery-2026-10-03.json, Git blob
0bc26fe071ede84f389c0ae345afac945d6f951a. This exact artifact has the
READY_FOR_PUBLICATION marker; the later published scan has matching findings.
The copied artifact remains exact; this branch cannot change source release authority.

Existing graph nodes: EMRADAR_FINDING -> X_DISCOVERY -> CONVERSATION_BASELINE ->
RELEVANCE_GATE -> INFORMATION_DELTA_GATE -> REPLY_DRAFT -> EVIDENCE_GATE ->
HUMAN_PREVIEW -> STOP. Every failure routes to STOP, never publication receipts.
GraphEngine.previewDiscovery uses the same graph definition and traversal engine.

POST /X_DISCOVERY_PREVIEW requires the existing MARKETING_ENGINE_TOKEN. GET on
the same protected route returns the saved preview. No public secret-reading or
authentication bypass route is added. The existing hosted startup calls a one-time
runner with its own engine token; public post/source review data is logged to Render.
Repeated startups return the saved result. Crashes with reserved spend block retries.
No normal campaign, scheduler, publication, performance or learning node is invoked.

Read-only connector: GET /2/tweets/search/recent and GET /2/tweets only.
Current documented prices checked 4 October 2026: post reads $0.005/resource,
user reads $0.010/resource. No reliance on billing deduplication.
https://docs.x.com/x-api/getting-started/pricing
https://docs.x.com/x-api/posts/search-recent-posts
https://docs.x.com/x-api/fundamentals/rate-limits

Bounds: two topic searches, ten posts each, author expansion only; up to five
conversation searches, ten posts each, no expansions; up to five post lookups.
At most twelve sequential requests, no pagination, no retries.
Worst planned resource spend: 2*(10*0.005+10*0.010)+5*10*0.005+5*0.005 = $0.575.
Hard reservation ceiling $0.75, leaving room below the owner's $1 ceiling.
Reservations persist before requests. Failed/ambiguous requests retain reservations.
Reported actual billing remains UNKNOWN pending provider reconciliation.
Response rate headers are recorded; zero remaining stops the branch.

Relevance matches named formations, excludes reply/quote/repost candidates and
returns at most five recent original posts with identified authors. Baselines
are bounded to recent-search visibility; protected/deleted/unindexed replies remain
unknown. Truncated conversations cannot pass the delta gate.

Information delta is conservative and deterministic. It compares every exact source
fact with the fetched root and replies, requires material implementation, scale or
financing detail, and rejects facts already present or without sufficient semantic
novelty. Every passing assessment is cryptographically bound to the fetched baseline
hash, exact source evidence index and exact evidence state. Review drafts use the
exact source fact, visible evidence state and an exact source uncertainty; long facts
require editorial compression and stay DO_NOT_REPLY. No forced CTA or financial
recommendation is inserted.
Native authenticated post lookup verifies unchanged post ID, text, author and time;
browser URL resolution is separately required before claiming complete verification.

This test intentionally does not update existing marketing learning. Future learning
integration and continuous discovery require separate scoped work/authority.
