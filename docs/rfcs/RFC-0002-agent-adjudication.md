# RFC-0002: Agent Adjudication Mode

- **Status:** Draft 1
- **Owners:** TBD
- **Last Updated:** 2026-08-12
- **Depends On:** [RFC-0001 Draft 3.1](RFC-0001-deterministic-evidence-planner.md)
- **Relationship:** Extends RFC-0001; does not amend it

---

## 1. Summary

RFC-0001 compiles a whole investigation plan from a declared goal. This RFC adds a second entry point for callers that cannot declare a goal up front because they discover their intent one step at a time — specifically, LLM agents.

An agent proposes a single action. The engine decides which concrete capability serves it, whether policy and budget permit it, whether it duplicates work already done in this session, and emits a decision record. The agent keeps its own control flow, prompts, and framework.

The engine does not orchestrate the agent and never becomes deterministic about it. It makes each consequential decision deterministic, and records why.

---

## 2. Problem

Agents in production fail in a small number of repeated ways, and all of them are decision problems rather than language problems:

- An agent crashes after invoking a paid or side-effecting tool, retries, and the effect happens twice.
- Spend is unbounded and unattributable; nobody can say why a session cost $400.
- Tool choice is unexplainable and unrepeatable — the same prompt picks a different tool next week.
- Constraints on tool use live in prompt text, which is not a control.
- In a multi-agent run, several agents independently commission the same paid work.
- When a decision is later challenged, the only artifact is a trace of what happened, not a record of why.

RFC-0001 solves all six for a caller that can state a goal. Agents cannot. The gap is not the machinery; it is the entry point.

**Why existing infrastructure does not close it:** Durable execution substrates give exactly-once semantics for a workflow you authored. An agent is precisely the caller with no authored workflow — it generates its plan at runtime, one step at a time. Observability platforms record what happened after the fact, which is not authorization before it. Neither category decides anything.

---

## 3. Goals

V1 MUST:

- Adjudicate a single proposed action against policy, budget, and prior session history, returning a typed verdict.
- Derive an idempotency key from what is being asked, not from how the model phrased it.
- Deduplicate semantically identical work across agents in one session.
- Enforce a session budget across concurrent agents without double-spending.
- Record every adjudication in a decision record verifiable under RFC-0001 §8.1 Class A.
- Refuse to compound a decision whose causal ancestors are known stale.
- Require no change to the agent's prompts, model, or framework.

---

## 4. Non-Goals

This RFC does not orchestrate agents, evaluate output quality, perform content safety filtering, or make an agent's trajectory reproducible. It does not replace the agent framework and does not schedule work.

It explicitly does not make the caller deterministic. §14 states what that costs.

---

## 5. Inherited from RFC-0001, Unchanged

This RFC adds an entry point, not a second engine. Everything below is inherited and MUST NOT be weakened:

- The compiler is a pure function of recorded inputs (§5.1, §7.2).
- No floating point in comparison, arithmetic, or serialization (§7.4).
- `UNKNOWN` is never coerced (§7.3, §7.6).
- Idempotency keys are derived before dispatch, exclude revision, digest a declared projection (§11.4).
- Personal data lives only in per-subject encrypted extents (§12).
- Every material decision emits a decision record, verified rather than recomputed (§8.1, §13).

`adjudicate()` is not a new solver. It is `compile()` over a single-assertion goal with a session-scoped context. Stating this now prevents the two paths diverging into two engines with two behaviours, which is the predictable three-year failure of this design.

---

## 6. Design Decisions

### 6.1 The Model's Output is Never an Input to a Digest

This is the load-bearing rule of the whole RFC.

An agent proposes *"look up Acme Corp in the German registry,"* then later *"get the DE company filing for Acme."* Same intent, different words. If the idempotency key derives from the model's phrasing, the key is as nondeterministic as the model, and every guarantee in RFC-0001 §11.4 collapses — the key must be stable exactly when the work is, and model output is stable never.

Fortunately the tool-calling interface already solves this: a tool call is structured JSON against a declared schema, not prose. The key derives from the canonical digest of the declared idempotency-relevant arguments, exactly as in RFC-0001 §11.4, and the model's word choice never enters it.

> **Rule:** Free text may select which structured intent is proposed. It may never be a field in one.

### 6.2 Deduplication Happens at the Intent Layer, Not the Tool Layer

§6.1 handles the same tool called twice with the same arguments. It does not handle two different tools commissioning the same work — `registry_lookup(name: "Acme")` and `company_search(q: "Acme")` are different digests and identical spend.

The fix is already in RFC-0001: assertion types. A tool is registered against the `NamespacedType` it satisfies, so the dedup key is `(sessionUid, assertionType, subjectDigest)` — what is being asked about whom — rather than which tool the model happened to name.

This is RFC-0001 §5.2 (*strategies declare requirements, the core picks providers*) applied to agents: the agent declares intent, the engine picks the tool. An agent that names a specific tool is expressing a preference, not a decision.

### 6.3 You Cannot Force an Agent to Reconsider, so Control Moves to Admission

In RFC-0001 the planner owns the plan, so an invalidated read-set entry triggers a replan. Here the agent owns the plan and cannot be replanned — it is a nondeterministic proposer, not a function.

*"Notify the agent that its premise is stale"* fails for the obvious reason: notification is a prompt, the agent may ignore it, and an ignored correctness signal is not a control.

So the control point moves. The engine cannot undo a decision already executed on a stale premise; it can refuse to admit new work that depends on one. §11 specifies stale-ancestor refusal.

> **Restated:** The engine does not fix the agent's mistake. It stops the mistake compounding, and records where it began.

### 6.4 Budget is Reserved, Not Checked

A naive `if (spent + cost <= ceiling)` races: two agents both read $0.50 remaining and both proceed. Budget is therefore a lease — reserved at adjudication, settled at outcome — serialized per session under the same optimistic concurrency as RFC-0001 §11.3. Leases expire, because an agent that dies holding one must not strand the session's budget forever.

### 6.5 Unmapped Tools Degrade, They Do Not Fail

Requiring every tool to be registered before it can be called would make adoption impossible — the first thing a new user does is point the gateway at tools nobody has classified. Unregistered tools run in a reduced tier: policy, budget, and argument-level idempotency apply; cross-tool dedup and selection do not (§12). Same laddering principle as RFC-0001 §9.6.

---

## 7. Core Data Model

### 7.1 Session and Agent Identity

```typescript
type AgentSession = {
  apiVersion: "evidence.engine/v1alpha2";
  kind: "AgentSession";
  metadata: ObjectMeta;              // RFC-0001 §6; tenant REQUIRED
  sessionUid: string;                // the investigationUid for all derived keys
  rootAgent: AgentRef;
  budget: SessionBudget;
  policySnapshot: SnapshotRef;
  capabilitySnapshot: SnapshotRef;
  openedAt: EpochMicros;
  status: "OPEN" | "EXHAUSTED" | "HALTED" | "CLOSED";
};

type AgentRef = {
  agentUid: string;
  parentAgentUid?: string;           // multi-agent: the spawning agent
  role?: string;                     // free-text label, never load-bearing
};
```

- `sessionUid` is the `investigationUid` in RFC-0001 §11.4's key derivation. Deliberate: every idempotency guarantee in RFC-0001 then applies across an entire agent run, including across sub-agents, with no new mechanism.
- `role` is explicitly non-load-bearing. A model-authored string must never affect a decision (§6.1).

### 7.2 Proposed Intent

```typescript
type ProposedIntent = {
  sessionUid: string;
  agentUid: string;
  proposalOrdinal: number;           // monotonic per session; ordering evidence, not a key input
  intent: StructuredIntent;
  causalAncestors: string[];         // adjudicationUids this proposal depends on
  agentRationale?: string;           // RECORDED, NEVER READ
};

type StructuredIntent =
  | { form: "ASSERTION"; type: NamespacedType; subject: TypedValue; parameters?: Record<string, TypedValue> }
  | { form: "TOOL_CALL"; toolName: string; arguments: Record<string, TypedValue> };
```

- `agentRationale` carries the model's stated reason. It is written to the decision record because an auditor will ask what the agent thought it was doing, and it is never read by any decision path. Any implementation that branches on it has reintroduced the model into the planning decision — the boundary this project exists to hold (RFC-0001 §5.1).
- `ASSERTION` form is preferred and enables §6.2 dedup. `TOOL_CALL` is what an unmodified MCP client emits, and normalizes to `ASSERTION` when the tool is registered (§12).

### 7.3 Adjudication

```typescript
type Adjudication = {
  adjudicationUid: string;
  sessionUid: string;
  agentUid: string;
  verdict: Verdict;
  resolvedCapabilityUid?: string;
  idempotencyKey?: string;
  budgetLeaseUid?: string;
  decisionRecordRef: ContentRef;     // RFC-0001 §7.5.1
  adjudicatedAt: EpochMicros;        // supplied by the caller; the engine reads no clock
};

type Verdict =
  | { decision: "PROCEED"; capabilityUid: string; estimatedCost: Money }
  | { decision: "SUBSTITUTE"; capabilityUid: string; insteadOf: string; reasonCode: number }
  | { decision: "DEDUPLICATED"; servedFrom: string; savedCost: Money }
  | { decision: "DENY"; reasonCode: number }
  | { decision: "ESCALATE"; escalationClass: string; reasonCode: number };
```

`DEDUPLICATED` is distinct from `DENY` on purpose. A denied call failed; a deduplicated call succeeded and cost nothing, and the agent should receive the prior result. Collapsing them would make the engine look like it was obstructing the agent when it was serving it — which is exactly how a correct control gets disabled by a frustrated engineer.

---

## 8. Intent Identity

```text
intentKey = H( sessionUid
             || assertionType
             || canonicalDigest(subject)
             || idempotencyDigest(parameters) )
```

- `idempotencyDigest` is RFC-0001 §11.4's declared projection, same default: fields are idempotency-relevant unless explicitly excluded. The asymmetry argued there holds identically — a wrongly-excluded semantic field means the agent asks a new question and receives the old answer, which is silently wrong evidence with verifying provenance.
- `proposalOrdinal`, `agentUid`, `agentRationale`, and wall-clock time are **not** inputs. Two agents asking the same question must collide; that collision is the feature.

**On subject normalization:** *"Acme Corp"*, *"Acme Corp."*, and *"ACME CORPORATION"* are one company and three digests. Normalization is real and out of scope for the key: it happens upstream, in a declared, versioned `SubjectNormalizer` registered per subject type, whose output is what gets digested. A normalizer is a registry artifact with conformance vectors (RFC-0001 §7.5), not a model call — a model call here would put nondeterminism back into the key by the side door.

Deployments with no registered normalizer dedup on exact match only. A real limitation, honestly bounded, and preferable to a probabilistic key.

---

## 9. Budget: Leases and Settlement

```typescript
type SessionBudget = {
  ceiling: Money;
  reserved: Money;
  settled: Money;
  overdraft: Money;                  // MUST be reported, never hidden
};

type BudgetLease = {
  leaseUid: string;
  sessionUid: string;
  agentUid: string;
  adjudicationUid: string;
  reservedAmount: Money;
  expiresAt: EpochMicros;
  status: "HELD" | "SETTLED" | "EXPIRED" | "RELEASED";
};
```

- **Protocol:** Adjudication reserves the capability's declared cost before returning `PROCEED`. The executor settles with actual cost on outcome, releasing the difference. Expiry releases the reservation. Reservation is serialized per `sessionUid` under optimistic concurrency on the budget's version — same discipline as RFC-0001 §11.3, same reason. Concurrent agents may hold independent leases; only one writer mutates the budget.
- Lease expiry must exceed the provider's maximum timeout — a configuration constraint, not a suggestion. A lease expiring while its call is in flight releases budget that is about to be spent, and the session over-commits.
- Overdraft is recorded, never retroactively denied. If settlement exceeds the ceiling — early lease expiry, or a provider charging more than declared — the money is gone. The engine cannot un-spend it. It records a typed `BUDGET_OVERDRAFT` fact naming the lease and amount, and policy decides whether the session halts. Pretending a spend can be refused after the fact is the same category error as RFC-0001 §11.7's in-flight attempt: no control on our side recalls a completed provider call.

---

## 10. Multi-Agent Composition

Agents map onto RFC-0001's contributor model directly: a multi-agent system is a set of concurrent contributors proposing requirements against a shared goal.

RFC-0001 §5.6 therefore already resolved the hardest coordination question. `priority: number` was deleted because *"a global integer ordering across a large contributor population becomes an unowned namespace, inflates, and produces merges nobody can debug"* — verbatim the *which agent wins* problem. Contributions merge by conjunction, precedence does not exist as a concept, and two agents proposing incompatible constraints produce a diagnosable unsatisfiable set naming both rather than a silent last-writer-wins.

Three properties follow with no new mechanism:

1. **Duplicate work dies at the key:** Three agents commissioning the same lookup produce one `PROCEED` and two `DEDUPLICATED`, because `sessionUid` is shared and §8's key excludes `agentUid`.
2. **Budget is shared and sub-allocable:** RFC-0001 §6 already models consumable resources owned by a tenant under a declared share; agents are that shape one level down.
3. **One ledger, not N traces:** Every adjudication lands in one decision-record chain with the proposing agent in provenance, so *"who decided to spend that"* is answerable across handoffs.

---

## 11. Causal Staleness Across Agents

The hard problem, structurally the same as RFC-0001 §11.7's split-brain one level up.

*Agent A adjudicates a decision reading fact F. Agent B produces output superseding F. A's decision now rests on a stale premise, and A has already acted.*

**Mechanism:** Every `Adjudication` records its read-set (RFC-0001 §5.5). The session maintains an index from read-set entry to dependent adjudications. When an entry advances or expires:

1. Every dependent adjudication is marked `STALE`, emitting a typed `PREMISE_SUPERSEDED` fact naming the adjudication, the entry, and the superseding output.
2. Transitively, any adjudication naming a stale adjudication in `causalAncestors` is marked `STALE_ANCESTOR`.
3. A new proposal whose `causalAncestors` contain a stale adjudication is refused — `DENY` with `STALE_ANCESTOR`, or `ESCALATE` where policy prefers a human. Never `PROCEED`.
4. Work already done is not undone; it is labelled. The agent is not corrected; it is prevented from building further on the error.

**Stated honestly:** This bounds blast radius, it does not restore correctness. An agent that acted on a stale premise has acted, and its output may already be in a customer's hands. What the mechanism guarantees is that the error is named at its origin and does not silently propagate through six downstream steps into a conclusion nobody can trace back. That is materially weaker than RFC-0001's replan, and weaker for a reason that cannot be engineered away: the caller is not a function.

Deployments needing the stronger property must use plan mode (§13), where the engine owns the plan and can replan it.

---

## 12. Tool Registration Tiers

| Tier | What is Registered | What You Get |
|:---:|---|---|
| **0** | Nothing — raw MCP passthrough | Policy check, budget lease, argument-level idempotency, decision record |
| **1** | Tool → `NamespacedType` mapping | Tier 0 plus cross-tool dedup (§8) |
| **2** | Tool → type + cost + predicates | Tier 1 plus capability selection and `SUBSTITUTE` |
| **3** | Plus a registered `SubjectNormalizer` | Tier 2 plus dedup across subject spelling variants |

Tier 0 must work on day one against tools nobody has classified. Every tier above is opt-in and pays for itself immediately — that is the adoption path.

---

## 13. Two Modes, One Engine

| Dimension | Plan Mode (RFC-0001) | Adjudicate Mode (this RFC) |
|---|---|---|
| **Caller States** | A whole goal | One action at a time |
| **Engine Owns** | The plan | The decision |
| **On Invalidation** | Replans | Refuses dependent work (§11) |
| **Multi-Step Data Flow** | Typed bindings between nodes | The agent's own control flow |
| **Guarantee Strength** | Stronger | Weaker, honestly bounded |

Both compile through the same pipeline. A caller MAY use both — an agent can hand a sub-goal to plan mode for the stronger property, then continue adjudicating. Recommended for any sub-problem that is expensive, multi-step, and known in advance.

---

## 14. What This Does Not Give You

Session trajectories are not reproducible. The sequence of intents depends on a model; replaying a session will not reproduce it. What is reproducible is every decision: given that the agent asked for X, the choice of capability B verifies against its recorded inputs, forever. The trajectory is recorded but not derivable.

Anyone claiming deterministic replay of an agent is either constraining the model to greedy decoding on pinned weights — a different product with a much smaller market — or is wrong. This RFC makes the consequential decisions deterministic and leaves the trajectory nondeterministic, because that is the only split that survives a model upgrade.

The engine cannot make a bad agent good. It can stop a bad agent from spending money it was not permitted to spend, doing the same paid work three times, acting twice on one retry, or compounding a stale premise. It cannot stop it from asking a foolish question well within policy.

---

## 15. Acceptance Criteria

1. An agent crash between tool invocation and outcome append produces exactly one provider effect, inheriting RFC-0001 AC-12 under `sessionUid`.
2. The same structured intent proposed twice with different `agentRationale` text produces an identical idempotency key.
3. Two different registered tools satisfying the same assertion type on the same subject produce one `PROCEED` and one `DEDUPLICATED`.
4. Three concurrent agents proposing the same intent produce exactly one paid call.
5. Concurrent adjudications cannot reserve past the session ceiling; the loser returns `DENY: BUDGET_EXCEEDED`.
6. An agent that dies holding a lease releases its reservation at expiry, and the session can spend it.
7. A settlement exceeding the ceiling records `BUDGET_OVERDRAFT` and never silently absorbs it.
8. A proposal whose `causalAncestors` include a `STALE` adjudication never returns `PROCEED`.
9. Every adjudication emits a decision record that verifies under RFC-0001 §8.1 with the live fact store deleted.
10. An unregistered tool (Tier 0) still receives policy enforcement, a budget lease, an idempotency key, and a decision record.
11. `agentRationale` provably does not affect any verdict: mutating it across otherwise identical proposals yields byte-identical decision records apart from that field.
12. Adjudication latency is bounded and does not scale with session length.

*AC-11 matters most. It is the executable form of the boundary in RFC-0001 §5.1, and the first test to fail if someone "improves" the engine by letting it read the model's reasoning.*

---

## 16. Delivery Phasing

- **Phase A — The Wedge (~4 weeks):** Tier 0 passthrough: session, budget leases, argument-level idempotency, decision record, MCP gateway. Sells on *"your agent will not double-charge and cannot exceed its budget."* No dedup, no selection, no staleness.
- **Phase B — Intent Layer:** Tool→type registration, cross-tool dedup, capability selection, `SUBSTITUTE`.
- **Phase C — Multi-Agent:** Sub-agent budget allocation, causal staleness index, session ledger across handoffs.

Phase A must ship without any of B or C. A gateway requiring a classification exercise before it does anything useful will not be installed.

---

## 17. Deferred Work

- Subject normalization beyond exact match and registered normalizers — in particular anything probabilistic — is deferred, and would require a design keeping nondeterminism out of the key.
- Cross-session deduplication is deferred. Obviously valuable, and it collides with RFC-0001 §12 erasure the moment a cached result concerns an erased subject.
- Agent-proposed relaxations — an agent arguing for a policy exception — are deferred and viewed with suspicion. RFC-0001 §9.4 permits relaxations only from `POLICY_OVERLAY` contributions with registered justification codes, and a model is not a policy author.