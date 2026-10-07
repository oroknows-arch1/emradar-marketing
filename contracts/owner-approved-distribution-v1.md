# Durable exact-artifact owner approval

PUBLICATION_REVIEW finishes preparation. Authenticated OWNER APPROVED accepts
its warnings and authorizes the exact persisted asset, recipient, subject and
physical route. Approval validates identity and review hash, persists
publication_approval and distribution_work, then returns HTTP 202 without
waiting for external providers. Preparation and generation never run after
this handoff. Advancing source scans does not invalidate reviewed artifacts.

The bounded distribution runtime wakes on approval, startup and every minute.
It loads the canonical proposal and its approved asset hash, then hands off to
the existing execute and receipt workers. Redis leasing allows restart resume;
an atomic IN_FLIGHT claim on the publication key fences concurrent delivery.
PUBLISHED, SUBMITTED, IN_FLIGHT and AMBIGUOUS receipts prohibit resend. Failed
or unavailable transports remain separate execution records and do not revoke
approval or block other destinations. They are not automatically retried.

Gmail can authenticate only as oroknows@gmail.com. Reviewed email bytes and
recipient bindings are preserved. Public forms require a real form adapter;
otherwise execution records TRANSPORT_UNAVAILABLE without a provider receipt.
X uses its exact approved text and visual together. Verified cost quotes and
the AUD 5 campaign / AUD 50 month envelopes remain mandatory. UNKNOWN stays
UNKNOWN; approval does not invent a quote or loosen spending limits.

Provider outcomes persist before cost settlement and receipt indexing.
Successful receipts join the existing outcome scheduler, measurement and
learning graph. Submission is never publication evidence. Missing outcomes
stay UNKNOWN. Campaign distribution state is stored separately from immutable
review assets. The recovery manifest contains only the eight exact identities
explicitly approved by the owner for EMRADAR_2026_10_06_LAUNCH. All identities
are checked before recovery approval, and recovery persists once.
