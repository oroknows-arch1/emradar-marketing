# EMRADAR connected-Earth editorial presentation

The reviewed email has one authoritative plain-text body. Its HTML is generated
deterministically from that body by `runtime/email-brand.cjs`. Both alternatives,
From, Reply-To and the brand version are included in the existing asset hash and
PUBLICATION_REVIEW hash. The relay verifies the same envelope and never rewrites
an approved message. Historical proposals are not migrated or reapproved.

Public identity: Sean Walker <sean@emradar.net>; replies: sean@emradar.net.
The connected-Earth banner is a versioned public reader asset. Website and email
assets are each encoded once directly from the same generated source.

Set these production variables on the existing **orok-studios-api** service:

- EDITORIAL_SMTP_HOST: the mailbox provider's authenticated SMTP host
- EDITORIAL_SMTP_PORT: 465
- EDITORIAL_SMTP_SECURE: true
- EDITORIAL_SMTP_USER: sean@emradar.net
- EDITORIAL_SMTP_PASSWORD: that mailbox's SMTP/app password (secret)
- EDITORIAL_IMAP_HOST: the provider's IMAP host (TLS port 993)

The existing relay token and URL remain unchanged. Preserve internal Gmail
credentials for collection of historical Gmail receipts. New canonical receipts
are collected from the canonical mailbox using the same bounded collector.
Configuration presence is not authentication proof: the existing sender-check
endpoint performs provider authentication without sending a message.

GET /branding/probe on the marketing service renders a retained regression
fixture, checks the relay's configuration status, and performs zero sends,
campaign admissions, approvals or store writes. It never uses today's campaign.

Regression commands:

`node --test tests/runtime/email-brand.test.js tests/runtime/approved-distribution.test.js tests/runtime/publication-review.test.js tests/runtime/editorial-outreach-gmail.test.js`

Relay: `node --test tests/email-brand.test.js`

Reader: `node scripts/verify-branding.mjs <reader-url>` (Playwright installed).
