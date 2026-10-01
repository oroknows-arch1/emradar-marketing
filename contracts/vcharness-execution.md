# VC Harness execution contract

EMRADAR Marketing owns domain logic. It does not implement a competing model router.

## Dependency

- Repository: `oroknows-arch1/vcharness`
- Routing contract: `elastic-routing-v0.1`
- Canonical routing files:
  - `src/routing/contracts.ts`
  - `src/routing/router.ts`
  - `src/routing/registry.ts`

Marketing emits bounded work units with complexity, separability, risk, sensitivity, tool, AI and verification requirements. VC Harness owns lane/provider/model/concurrency/escalation decisions.

## Usage rule

Prefer deterministic execution whenever AI is unnecessary. Otherwise use the lowest-cost permitted available route adequate to the work unit. Wide separable work requests the Harness wide-parallel lane. Escalation is bounded and evidence-driven.

Marketing must never hard-code a provider as available. The checked-in Harness registry currently defines `moonshot/kimi-k3` for `wide-parallel` but marks it disabled/unavailable; runtime availability belongs to the Harness.

## Failure behaviour

If no eligible route exists, return a blocker/human gate. Do not silently fall back to an expensive model, broad search, or unbounded serial work.
