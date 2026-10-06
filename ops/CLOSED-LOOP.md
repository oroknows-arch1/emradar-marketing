# Persistent marketing feedback loop

The executable graph remains `graph/marketing-graph-v1.json`. Its return edges are
`receipt → observe (OUTCOME_COLLECTOR) → normalize (OUTCOME_EVIDENCE) →
performance_analysis → learn → distribution_map (ROUTING_UPDATE)`.
Future `route` reads both bounded technical delivery history and `routing_memory`.
No recursive scan ingestion occurs in feedback. Source truth is immutable.

## State and evidence

Prepared/approved/submitted/provider-accepted events are anchored to existing
artifacts, approvals and receipts. SMTP acceptance does not establish reading,
editorial interest or publication. Successful, complete bounded mailbox checks
can record NO_OBSERVED_OUTCOME; failed/truncated checks leave UNKNOWN. Silence
never records rejection. Header-matched replies establish RESPONSE_RECEIVED only.
Permanent DSN failures require the original RFC message ID, recipient block,
failed action and a 5.x status. Interest, information requests and rejection
require an explicit reviewed statement linked to a real reply; no sentiment model.
PUBLISHED requires a provider's actual public X post receipt or a retrieved,
domain-verified publication page with exact artifact attribution, date and hash.
Candidate URLs and search similarity are not publication evidence.

## Storage

Existing Redis prefix: `marketing:graph:`. No TTL is applied to these records.

| Key | Purpose |
| --- | --- |
| `receipt:<id>` / `receipt_history:<id>` | Submission receipt and prior attempts |
| `publication_review:<proposal>` / `publication_approval:<proposal>` | Exact artifact and owner decision |
| `signal_snapshot:<product>:<formation>:<revision>` | Approved evidence linkage |
| `outcome:<id>` | Current derived outcome, dimensions and uncertainty |
| `outcome_event:<id>:<hash>` / `outcome_history:<id>` | Immutable event records and append-only index |
| `outcome_index` / `receipt_index` | Durable retrieval and collection indexes; no truncation |
| `feedback_run:<run>` / `feedback_history:<id>` | Bounded graph execution traces |
| `performance_analysis:<hash>` / `performance_analysis` | Versioned observations and current analysis |
| `routing_memory:<hash>` / `routing_memory` | Versioned learning provenance and current routing input |
| `route_evaluation:<product>:<formation>:<revision>` / `:history` | Explicit X decision and history |
| `publication_candidates:<id>` / `publication_check:<id>:<hash>` | Candidate queue and page-check evidence |
| `campaign_cost_index:<campaign>` / `campaign_cost:<run>` | Existing cost ledger references |

Records/history are queryable through authenticated `GET /OUTCOME_REVIEW` using
the existing publication-review Bearer authority. Optional `receipt_id` selects
one history; `destination` selects a hypothetical routing-memory read. No scan
is processed by this read. POST accepts only COLLECT (one to four existing receipt
IDs), X_EVALUATE (an existing proposal with unchanged saved source), and
PUBLICATION_CANDIDATE (an existing receipt plus HTTPS URL on its verified domain).
REPLY_CLASSIFICATION may refine a previously matched response only when the owner provides an explicit reviewed statement and its existing reply message ID. No classifier infers sentiment from arbitrary mail. These operations do not approve or send. Existing approval/auth/hash/idempotency
checks remain responsible for publication.

## Collectors and automation

Gmail read operations use the existing pinned HTTPS Starter relay and the current
`oroknows@gmail.com` app password, without persisting/logging credentials in the
relay. IMAP uses read-only mailbox locks and bounded exact RFC message-ID searches
in All Mail, Junk and Trash (INBOX fallback). At most 20 messages per mailbox and
64 KiB per message; truncation prevents negative conclusions. Bodies are parsed
transiently; only identifiers, match evidence and hashes leave the relay.
Matched reply links may queue up to three verified-domain publication candidates.
The page worker uses HTTPS, no redirects, a 256 KiB cap, and a ten-second timeout.
It conservatively leaves modified/unattributed articles UNKNOWN.

Signed GitHub OIDC `/SCHEDULED_CYCLE` wake-ups now pin the immutable GitHub owner/repository IDs (273911094/1399375858), exact main-branch subject, repository, workflow, event, issuer, audience and expiry. The old name-only subject rejected this newly created repository. Existing wake-ups and live-process timer
collect at most one due receipt per cycle. Render Free sleep is handled by the
existing GitHub wake-up workflow. No new cron service or paid datastore is used.

## Learning and X

Analysis retains formation/source/region/industry/angle/format/language/cost,
observed states, channel-native metrics and response timing when available.
Every signal includes receipt references, sample size, independent formations,
positive/negative/neutral evidence, confidence, uncertainty and analysis reference.
At least three independent formation/source observations and three non-neutral
outcomes are required before editorial ranking changes. Adjustment is capped at
0.15, cannot create relevance, and leaves new destinations neutral. Technical
delivery reliability remains separate from editorial success.

Every EMRADAR scout explicitly records X_SELECTED or X_NOT_SELECTED, including
authorization, source, relevance, format, permission and cost checks. Unknown X
billing is ACTUAL_COST_BOUND_UNKNOWN; it cannot disappear silently or become zero.
Native X formatting reuses a whole approved fact and the first source qualification clauses within 280 characters; an oversized fact blocks explicitly rather than being truncated. Selected X artifacts still require exact owner review under the current register.
The OAuth refresh/expiry check does not claim to prove API access or revocation
without an actual provider call. Paid metrics remain gated by verified quotes and
existing budgets; absent metrics are UNKNOWN, not zero. Real X post receipts use
the same outcome/analysis/learning path as emails. An actual X creation receipt is distinguished from a fetched publication page; self-publication is not positive audience evidence. Measured likes/impressions can influence X ranking only after three distinct formations and three comparable observations, with provenance and the same 0.15 cap.

## Scan hold and cost

`config/scan-control.json` holds actual new EMRADAR scan intake, startup pending
source/campaign launch and normal campaign runs. Feedback remains executable.
Only a later owner-authorized next-scan task may release this hold; completing
feedback does not itself process the next scan.

Existing services remain Free executor + US$7/month Starter relay. Additional
recurring cost: US$0. No new paid API probe, paid search, generation or distribution
is required for feedback or a cost-rejected X evaluation.
