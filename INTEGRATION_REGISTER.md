# Integration Register and Owner Setup Record

`state/integration-register.json` is the authoritative machine-readable account and connector register. It is separate from `state/distribution-map.json`: the register answers whether a platform can be used safely; the Distribution Map remembers destination routes and their results.

## Owner-time rule

The owner creates or verifies an account once, completes platform-required identity/security checks, grants the prepared authorization, approves any real cost, and leaves. The engine owns routine token refresh, native formatting, publishing, receipts, retries, measurements and visible failure handling wherever the platform permits.

No password, token, client secret, recovery code, phone number or private email address belongs in Git, issue text, campaign state or a receipt.

## Evidence-based lifecycle

| State | Required evidence |
|---|---|
| `NOT_CREATED` | No confirmed account identity is available. |
| `ACCOUNT_CREATED` | Public handle and account URL are recorded. |
| `VERIFIED` | The platform's required owner verification is complete. |
| `CONNECTED` | Required publishing scope has been granted. |
| `AUTH_PERSISTED` | Authorization is in the deployment secret store and renewal behavior is known. |
| `TESTED` | A controlled real publication returned a platform ID/URL and was read back. |
| `AUTONOMOUS` | Event handoff, gates, duplicate prevention, publishing, receipts, refresh, retries and monitoring have passed end to end. |

Status may move backward when access is revoked or evidence becomes stale. A green UI state must never be inferred merely from the existence of an adapter.

## Current record — 3 October 2026

- X is `TESTED` for `@oroknows`. The repository contains both the working OAuth/media publisher and a verified live receipt. It is not `AUTONOMOUS`: billing is unknown, the source event/scheduler chain is not yet proven end to end, and exact publication review remains required.
- LinkedIn, Bluesky and Mastodon text connectors are implemented but remain unconfigured and untested against real accounts. Their register state therefore remains `NOT_CREATED`.
- Threads and Reddit connectors are not implemented. Their exact missing configuration is exposed by the protected integration-status endpoint.
- Reddit is permanently community-specific. It is not part of indiscriminate cross-posting.

Runtime readiness is available from authenticated `GET /integrations/status`. It reports connector implementation, missing environment-variable names and authorization state without returning credential values.

## Build before owner signup

For each unconnected platform, implement and test these items first:

1. Native connector and media rules.
2. Production callback URL and least-privilege authorization scopes.
3. Deployment secret names and refresh/revocation behavior.
4. Dry run plus idempotency key/duplicate prevention.
5. Platform receipt capture: item ID, canonical URL, account, timestamp and final state.
6. Measurement collection with truthful `UNKNOWN` when unavailable.
7. Rate-limit, partial-failure and revoked-authorization states on the Scan & Distribution page.

Only then schedule one consolidated owner session. This avoids repeated account work and prevents developer applications being configured against placeholder callback URLs.

## Consolidated owner session

1. Confirm the common public identity: name, handle preference, biography, logo and EMRADAR homepage URL.
2. Resolve whether X remains `@oroknows` or becomes a dedicated EMRADAR identity.
3. Create and verify LinkedIn, Bluesky, Threads, Mastodon and Reddit accounts in that order.
4. Keep recovery material in the owner's password manager; record only public account identity here.
5. Approve each prepared authorization screen. Pause any platform that presents an unapproved cost.
6. Approve Reddit communities independently of account creation.
7. Observe one controlled route-specific test per platform.
8. Finish with every platform either `TESTED` or carrying one exact blocker and next owner action.

## Official references

- X API: <https://docs.x.com/x-api>
- LinkedIn Community Management: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview>
- LinkedIn Posts API: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api>
- Bluesky post creation: <https://docs.bsky.app/docs/tutorials/creating-a-post>
- Threads API: <https://developers.facebook.com/docs/threads>
- Mastodon posting API: <https://docs.joinmastodon.org/methods/statuses/>
- Reddit for Developers: <https://developers.reddit.com/docs/>

Requirements and prices change. Recheck official documentation immediately before implementing or authorizing each connector.
