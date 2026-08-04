# RFC 0001: Deterministic Evidence Planning Platform

- **Status:** Revised Draft 3.1 — **approved for Phase 0 implementation** (architecture panel, 2026-08-05)
- **Owners:** TBD
- **Last updated:** 2026-08-05
- **Supersedes:** Revised Draft 3 (2026-08-05)
- **Review disposition:** Draft 2 review in §17; architecture panel review in §18; re-review in §18.6

## 1. Summary

Define a deterministic evidence-planning platform that compiles a versioned, declarative investigation goal and an immutable planning context into an execution graph, then reconciles and executes that graph as new state arrives.

The compiled graph is not a static tape of pre-rendered requests. It is a declarative graph with typed data-flow bindings, conditions, and unresolved nodes that a controller reconciles as execution state changes.

**Every compilation produces an authoritative decision record.** The decision record — not re-execution of the planner — is the primary reproduction artifact. Deployments that additionally require bit-exact recomputation opt into a stricter determinism class (§8.1).

## 2. Problem

Evidence acquisition combines domain requirements, capability eligibility, policy constraints, and runtime-discovered identifiers. Coupling those concerns to LLM reasoning, retrieval SDKs, or a single batch request makes plans hard to replay and unsafe to evolve. A purely front-loaded DAG is also insufficient: later requests frequently depend on values emitted by earlier acquisition steps.

## 3. Goals

V1 MUST:

1. Compile composite, namespaced investigation goals into a declarative execution graph.
2. Support typed bindings from prior step outputs and explicit conditional nodes.
3. Make compilation a pure function of a recorded, immutable planning context.
4. Record a decision record sufficient to **explain and verify** every material decision, and to detect when a decision's inputs have changed.
5. Isolate domain requirement logic in versioned, sandboxed strategy bundles.
6. Select only from the supplied capability set; the compiler MUST NOT retrieve evidence or query infrastructure.
7. Reconcile graph revisions from relevant state changes without hidden executor decisions.
8. Guarantee that a duplicated or retried execution attempt does not produce a duplicate provider side effect.
9. Support erasure of personal data without invalidating the audit chain.

## 4. Non-goals

This RFC does not prescribe a provider-distribution transport, provider adapter implementation, secret-management system, LLM interpretation of natural language, learning system, or a particular solver implementation. It does not guarantee that a provider will succeed or that acquired evidence is true.

**Changed non-goal — durable execution.** Draft 1 disclaimed prescribing a durable-workflow product and then specified durable timers, join semantics, retry policy, optimistic concurrency, and an immutable event log. That was a workflow engine specified in half a page. This RFC now requires the execution layer to be **implemented on a durable execution substrate** meeting the properties in §11.1. It still does not prescribe *which* substrate. Reimplementing one is out of scope and explicitly discouraged.

## 5. Design Decisions

### 5.1 Retained: deterministic planning before LLM reasoning

Candidate selection and policy enforcement are auditable only when they do not depend on an LLM's unstated reasoning. An upstream semantic system may translate human language into a `GoalSpec`, and an LLM may reason over acquired evidence, but neither is part of this protocol's planning decision.

### 5.2 Retained: strategies contain domain knowledge, the core owns infrastructure

Strategies derive requirements and graph templates. They do **not** rank concrete providers or make infrastructure decisions. This prevents a domain plugin from embedding cost, health, and tenancy policy.

### 5.3 Retained: goals are composite declarations, not mapped scalar intent

There is no built-in intent mapper and no scalar `investigationType`. Callers submit a formal, namespaced `GoalSpec` containing one or more assertions. Administrative policy is not part of GoalSpec: the control plane binds policy at reconciliation time so SecOps can change policy without rewriting a caller's desired investigation.

### 5.4 Changed: planning context replaces four independent snapshots

Draft 1 resolved capability, operational-state, policy, and execution-state snapshots independently with no defined join. That is a dangling-reference hole and a TOCTOU hole. Compilation now takes a single `PlanningContext` with a mandatory referential-integrity check (§7.2).

### 5.5 Changed: operational facts are per-resource versioned, not globally snapshotted

Content-addressing an artifact whose contents change on every health check mints a new global digest per delta across N providers. Within a year the operational-snapshot store dominates storage, retention policy ships, and replay silently becomes aspirational.

Operational facts are now a **per-resource versioned store**. Compilation records a **read-set**: the exact `(resource, version, validUntil)` tuples it touched. Capability and policy artifacts remain whole-artifact content-addressed — they are slow-changing, and "which policy was in force" must be answerable as a single citable artifact, not reassembled from fragments.

Read-set recording also **replaces the hand-written relevance rules** of Draft 1. A revision is stale iff a resource in its read-set has advanced or expired. That is sound by construction rather than by enumerating four cases correctly.

### 5.6 Changed: fragment composition is a semilattice, not a priority ordering

`priority: number` is removed. A global integer ordering across a large contributor population becomes an unowned namespace, inflates, and produces merges nobody can debug. `RequirementFragment` is now a **set of constraints merged by conjunction** — idempotent, commutative, associative. Ordering ceases to be a concept. Conflicting contributions produce a diagnosable unsatisfiable constraint set instead of a silent last-writer-wins (§9.3).

### 5.7 Changed: purity is enforced by the substrate, not declared

Draft 1 required strategies to be pure and then delegated sandbox mechanics to deployment. The enforcement point of the central safety property cannot be delegated and still claimed. Strategies now execute in a **Wasm sandbox with no clock, randomness, or network imports, fuel-metered** (§9.5). Purity becomes structurally impossible to violate, and strategy authors gain any language that targets Wasm.

### 5.8 Changed: the matching algebra is a first-class registry artifact

Draft 1 had strategies emit requirements and the core match them against capability attributes, but never defined the vocabulary that match is expressed in. That left the wire between the two typed endpoints untyped, to be settled informally and out-of-band. `AttributeDefinition` and a closed predicate language are now normative (§7.3).

### 5.9 Changed: graph bindings stay JSON Pointer, goal references go nominal; conditions get a defined grammar; transforms get a registry

Draft 1 claimed v1 needs no expression language and then declared `condition?: Expression`. That was self-deception. Conditions with three-valued semantics *are* a language, so §7.6 defines one: closed, total, non-recursive, with published truth tables and a conformance suite.

Transformations remain explicit graph nodes rather than inline expressions — that is the auditability property the platform exists for — but transform types are now **namespaced registry artifacts**, not a closed enum. See §17.3 for why full CEL is deferred and what would trigger adopting it.

**Draft 3 splits the two binding sites.** Bindings *inside a compiled graph* remain RFC 6901 pointers: they are compiler-generated, typechecked in the same compilation, and discarded with the revision, so they cannot drift. Bindings *in a submitted `GoalSpec`* are now nominal `outputRole` references, because a caller's stored goal outlives the payload schemas it would otherwise point into, and because a structural pointer is the field an upstream generator is most likely to get plausibly wrong (§7.1).

### 5.10 New: decision record is the reproduction artifact

See §8.1. Byte-identical cross-platform re-derivation, including a deterministic exact ILP solver, is a research-grade commitment that Draft 1 made in passing and did not fund. The property actually required — explain and verify a decision — is obtainable at a small fraction of the cost.

### 5.11 New: evidence lives in a crypto-shredded blob plane

Draft 1 required tamper-evident immutable logs and retention policies for a platform that holds personal data about identifiable people, and did not mention erasure. Those obligations are in direct conflict. §12 resolves it.

### 5.12 Changed: declarative contributions are the default; Wasm is the escape hatch

Draft 2 called a strategy bundle "a package of declarative strategies" and then defined the contribution interface as an imperative `expand()` function that every author had to compile to Wasm. Those two sentences describe different systems, and the imperative one was load-bearing.

A contribution that maps an assertion to a fixed set of requirements — which is most of them — is a table, not a program. §9.1 now defines a **declarative contribution form** evaluated natively by the core, and Wasm is reserved for contributions that genuinely compute. This removes the toolchain from the common path, makes the fifteen-minute target in §9.6 credible rather than aspirational, and has a correctness dividend: a declarative contribution's production frontier is **derived** by the linter rather than hand-declared, which removes the largest source of the unsound-closure risk in §10.2.

### 5.13 New: attempts have a lifecycle across revisions

Draft 2 serialized revision publication (§11.3) and derived idempotency keys independent of revision (§11.4), but never said what happens to an attempt that is **already in flight at a provider** when a new revision is published. Nothing in the document made the outcome of an obsolete attempt inadmissible, so a side effect authorized by a superseded revision could satisfy a node in its successor.

Serializing the event stream does not fix this; no ordering discipline recalls a request that is already at the provider. §11.7 gives attempts an explicit lifecycle — `CARRIED`, `ORPHANED`, `QUIESCED` — evaluated at every revision boundary.

### 5.14 Changed: idempotency keys digest a declared projection, not the whole request

Keying on the digest of the entire resolved request makes the key sensitive to fields that carry no semantic weight. An additive schema change that adds a default timeout mints a new key for identical work and permits the duplicate paid call the key exists to prevent.

Request schemas now mark which fields are idempotency-relevant, and §11.4 digests only that projection. This preserves the property that matters — the key is stable exactly when the *work* is, and changes exactly when the question being asked changes.

## 6. Tenancy and Common Metadata

Every top-level object carries:

```ts
type ObjectMeta = {
  uid: string;
  tenant: TenantRef;            // REQUIRED. Single-tenant deployments use a reserved constant.
  createdAt: EpochMicros;       // data supplied by the control plane, never read from a clock by core
  labels?: Record<string, string>;       // selectable, validated key syntax
  annotations?: Record<string, string>;  // non-selectable escape hatch, opaque to the core
};
```

`tenant` is load-bearing, not cosmetic. Every consumable resource bound — notably `concurrencySlots` — is owned by a tenant and allocated under a declared share in the policy snapshot. Without this, noisy-neighbor is unrepresentable and the first multi-tenant deployment discovers it in production.

`annotations` exists because every API of this shape that omitted an escape hatch grew one within a year, in a worse form.

## 7. Core Data Model

All objects use versioned schemas and canonical serialization. Numeric values are signed fixed-point integers with an explicit unit and scale. **Floating-point values are prohibited in comparison, arithmetic, and serialization.**

### 7.1 GoalSpec

```ts
type GoalSpec = {
  apiVersion: "evidence.engine/v1alpha1";
  kind: "InvestigationGoal";
  metadata: ObjectMeta;
  assertions: GoalAssertion[];
  constraints: GoalConstraints;
};

type GoalAssertion = {
  uid: string;
  type: NamespacedType;
  subject: TypedValue | GoalInternalBinding;
  parameters?: Record<string, TypedValue | GoalInternalBinding>;
  required: boolean;
};

// A GoalSpec is self-contained. It may reference its own assertions and nothing else.
type GoalInternalBinding = {
  source: "GOAL_ASSERTION";
  assertionUid: string;   // MUST resolve within this GoalSpec
  outputRole: string;     // a projection NAME declared by the referenced assertion type
  expectedType: SchemaRef;
};
```

Draft 1 allowed `subject: TypedValue | Binding` where `Binding.source` could be `STATE` or `NODE_OUTPUT`, which made a GoalSpec non-self-contained and its legal forms unspecified. `STATE` and `NODE_OUTPUT` are now rejected at goal admission. Goal-internal references MUST be acyclic.

**`outputRole` replaces Draft 2's `path: RFC 6901 JSON Pointer`.** A JSON Pointer is a *structural* reference into a payload the caller does not own. Payload schemas get refactored, fields get renamed and renested, and every stored goal template that pointed into the old shape breaks — silently, at admission, long after whoever wrote it moved on. It is also the single field an upstream LLM is most likely to hallucinate into a plausible-looking wrong answer, because pointer syntax is guessable and pointer *validity* is not.

An `AssertionTypeDefinition` therefore declares a closed set of named output projections, each with a schema:

```ts
type AssertionTypeDefinition = {
  name: NamespacedType;
  owner: NamespaceOwnerRef;
  subjectSchema: SchemaRef;
  parameterSchema?: SchemaRef;
  outputRoles: Record<string, SchemaRef>;   // nominal, stable across minor versions
  deprecation?: DeprecationRecord;
};
```

References are now **nominal, not structural**. Payload refactors are invisible to callers so long as the named roles still resolve, and the role set is governed by the same ownership, versioning, and deprecation ladder as every other registry type (§14). An unknown role is a typed admission error naming the declared roles — a closed vocabulary an upstream generator can be constrained to, rather than an open string it can invent.

`NamespacedType` is a reverse-DNS namespace plus name and version (`com.example.vendor/registration@v1`). Assertion UIDs are immutable and caller-assigned.

**Deprecated assertion types resolve at admission**, and the ladder is total over the four statuses:

| Status | Admission behavior |
|---|---|
| `ACTIVE` | Admitted as submitted. |
| `DEPRECATED` | Rewritten to the declared replacement, admitted, both types recorded in provenance, warning diagnostic returned. |
| `SUNSET` | Rewritten and admitted as above, but the diagnostic is an error-severity warning and the rewrite is counted against a policy-declared grace budget. |
| `WITHDRAWN` | **Rejected**, naming the last known replacement. A withdrawn type has no defined semantics; admitting it by silently following a stale pointer would compile a goal nobody has validated. |

Resolution is **transitive with a bounded chain** — at most a policy-declared number of hops, default eight — and cycles are a registry publication error, not an admission-time infinite loop. Draft 3 specified only the `DEPRECATED` case and said nothing about the other three, which left the two most consequential ones (what happens at `WITHDRAWN`, and whether a chain of renames resolves) to be settled per-implementation.

Long-lived stored goal templates are the normal case in this domain, and a registry with a replacement pointer that nothing follows is a registry that breaks them on every rename. But the resolution is a **migration aid, not a substitute for migration**: rewrite counts are reported per goal-template owner so accumulated deprecation is visible to whoever can fix it, rather than absorbed indefinitely by the admission layer until a `WITHDRAWN` transition breaks everything at once.

### 7.2 PlanningContext and compilation request

```ts
type CompileRequest = {
  goal: GoalSpecRef;                 // by reference; see note below
  context: PlanningContextRef;
  traceLevel: "NONE" | "SUMMARY" | "VERBOSE_AUDIT";
};

type PlanningContext = {
  capabilitySnapshot: SnapshotRef;
  policySnapshot: SnapshotRef;
  exchangeRateSnapshot?: SnapshotRef;
  strategyBundle: BundleRef;
  operationalFacts: OperationalFactRef[];   // per-resource, versioned
  stateFacts: StateFactRef[];               // per-address, versioned
  planningInstant: EpochMicros;             // time as data; the compiler never reads a clock
  integrityDigest: string;                  // over the canonicalized REFERENCE TUPLE; see below
};

type OperationalFactRef = {
  capabilityUid: string;
  version: string;            // monotonic per resource
  observedAt: EpochMicros;
  validUntil: EpochMicros;    // observedAt + policy max staleness for this attribute class
};

type SnapshotRef = { digest: string; schemaVersion: string };
```

**Everything is passed by reference.** Draft 1 defined `SnapshotRef` and then had `CompileRequest` take snapshots by value, which made canonical hashing of the request ambiguous — the same logical request had many encodings.

**`integrityDigest` is computed over the canonicalized tuple of references above — never over resolved artifact bytes.** Draft 2's phrase "over the fully resolved, canonicalized context" invited exactly the opposite reading: that every compilation re-canonicalizes and re-hashes multi-megabyte Wasm bundles and policy documents. It does not, and could not afford to. Artifact digests are computed **once, at publication**, which is what content-addressing means; the context digest is a hash over a few dozen fixed-size digest strings. Referential-integrity checking resolves references to validate them, but resolution is not an input to the digest.

This also bounds the cost: the digest is recomputed only when the reference tuple changes, and compilation runs only on read-set invalidation (§11.2), not on every reconciliation tick. The hot path never constructs a `PlanningContext` at all.

**Operational fact versions advance on material change only.** A version is minted when a resource's **decision-relevant projection** changes — the attribute values that predicates can observe. A health check that re-observes identical values refreshes `observedAt` and `validUntil` in place and does **not** mint a new version. Without this rule, a 10-second health poll across N providers mints 8,640·N versions per day, every one of them read-set-invalidating and none of them capable of changing a decision. The projection is derived from the capability's declared attribute set, so it is computed, not curated.

**Purging expired facts does not weaken audit.** Under Class A, the decision record carries the read-set *and* the fact values the decision turned on (§13); verification is against the record, not against the live fact store. Fact retention is therefore an operational-cost decision, independent of the audit period. This is a direct consequence of choosing verification over recomputation in §8.1, and it is the second place that choice pays for itself.

**Referential integrity is mandatory.** Before compilation the reconciler MUST verify:

1. Every `capabilityUid` appearing in `operationalFacts` exists in the capability snapshot.
2. Every capability referenced by policy exists in the capability snapshot.
3. Every `AttributeDefinition` referenced by a capability or a requirement predicate is present at a compatible version.
4. Every `observedAt <= planningInstant`, and `planningInstant < validUntil` for every fact the policy classifies as staleness-sensitive.

Failure of any check is a typed `CONTEXT_INTEGRITY_VIOLATION`, never a silent skip. Draft 1 left the behavior on a dangling `capabilityUid` undefined, which is exactly where two conforming implementations diverge.

**Time is data.** Draft 1 had no `observedAt` anywhere and still asked for a snapshot-staleness metric (§13). A system that forbids reading clocks must still carry time as an input. `planningInstant` is supplied by the reconciler and recorded; the compiler remains a pure function.

### 7.3 The matching algebra

This is the vocabulary in which strategy requirements and capability attributes meet. It is a registry artifact with an owner, not an informal convention.

```ts
type AttributeDefinition = {
  apiVersion: "evidence.engine/v1alpha1";
  kind: "AttributeDefinition";
  name: NamespacedType;              // com.example.geo/country@v1
  owner: NamespaceOwnerRef;
  valueType: "BOOL" | "ENUM" | "IDENTIFIER" | "INTEGER" | "QUANTITY" | "SET";
  enumValues?: string[];             // ENUM: closed, never renumbered or reused
  unit?: UnitRef;                    // QUANTITY: required
  scale?: number;                    // QUANTITY: required, fixed-point exponent
  ordering: "NONE" | "TOTAL";        // gates use of LT/LTE/GT/GTE
  elementType?: NamespacedType;      // SET
  unknownPolicy: "TREAT_AS_UNKNOWN"; // never coerced to a default
  deprecation?: DeprecationRecord;
};
```

```ts
type Predicate =
  | { op: "EQ" | "NEQ"; attribute: NamespacedType; value: TypedValue }
  | { op: "IN" | "NOT_IN"; attribute: NamespacedType; values: TypedValue[] }
  | { op: "LT" | "LTE" | "GT" | "GTE"; attribute: NamespacedType; value: TypedValue }
  | { op: "SUPERSET_OF" | "INTERSECTS"; attribute: NamespacedType; values: TypedValue[] }
  | { op: "PRESENT" | "ABSENT"; attribute: NamespacedType };
```

Evaluation is **three-valued (Kleene)**. A predicate over an absent or `unknown` attribute evaluates to `UNKNOWN`, never to `FALSE`. The policy snapshot declares, per data classification, whether `UNKNOWN` eligibility is admissible; the default is inadmissible.

**`UNKNOWN` here does not stall anything.** Predicate `UNKNOWN` in capability matching is resolved *within the compilation that raised it*: policy declares admissibility, and the default — inadmissible — filters the capability out of the candidate set with a recorded decisive constraint. No timer is involved, and no node waits. The `UNKNOWN` that interacts with `pendingDeadline` is the *condition* `UNKNOWN` of §7.6, which is a different construct in a different phase. Draft 2 stated both in the same vocabulary without distinguishing their consequences, and reviewers reasonably read the timer semantics onto both.

The distinction is worth stating as a rule: **`UNKNOWN` in matching means "this capability is not eligible unless policy says otherwise." `UNKNOWN` in a condition means "this value has not arrived yet."** The first is a decision; the second is a wait.

**The operator set is closed, and extension goes through attributes rather than operators.** The set above deliberately omits regex, IP-subnet, and geo-distance matching. Contributors will need all three, and the extension point for them is `AttributeDefinition`, not `Predicate`:

- IP containment becomes an attribute of `valueType: SET` over a prefix element type, matched with `INTERSECTS`.
- Geo-distance becomes a `QUANTITY` attribute produced by a registered `TransformDefinition` (§7.5) with mandatory conformance vectors, matched with `LTE`.
- Pattern matching becomes an `ENUM` or `SET` attribute whose classification is performed by a registered transform at publication or observation time, matched with `EQ`/`IN`.

The reason to route extension this way rather than growing the operator set is AC-4. Every operator must produce identical results in every supported runner language, and regex is the canonical counterexample: the engines disagree on Unicode classes, anchoring, and backreference semantics, and backtracking behavior turns a predicate into an unbounded-time evaluation inside the compiler. An operator that cannot be conformance-tested across languages cannot be in a language that promises cross-language conformance. Pushing the computation into a versioned, vector-tested transform keeps the nondeterminism in one owned, testable artifact instead of spreading it across every implementation of the predicate evaluator.

Adding a new operator remains possible, but it is a **planner API version change** requiring a conformance-suite extension — deliberately a heavier procedure than registering an attribute or a transform, which any contributor can do without core involvement.

Type checking is static: `LT`/`LTE`/`GT`/`GTE` require `ordering: TOTAL`; `SUPERSET_OF`/`INTERSECTS` require `valueType: SET`; `QUANTITY` comparisons require identical unit and scale, with conversion performed only through registry-declared exact conversions. A predicate that fails to typecheck is a bundle publication error, not a runtime surprise.

A cross-language **predicate evaluation conformance suite** is normative (AC-4).

### 7.4 Money and fixed-point arithmetic

```ts
type Money = {
  amountMicros: string;   // canonical decimal integer string
  currency: string;       // ISO 4217
};
```

`amountMicros` is a **string**, not `bigint`. `bigint` has no canonical JSON encoding, and Draft 1 paired it with a byte-identical serialization requirement. Canonical form: optional leading `-`, no leading `+`, no leading zeros except the single digit `0`, no `-0`, no exponent, no separators.

Normative arithmetic rules, all absent from Draft 1 and each sufficient on its own to make two conforming implementations disagree by one micro:

- **Rounding mode:** half-even, applied exactly once, to the final result of a conversion or aggregation chain. Intermediate results are carried at full precision.
- **Conversion path:** use the direct rate if the exchange-rate snapshot contains one. Otherwise triangulate through the snapshot's declared `baseCurrency`, with exactly one intermediate hop. If neither path exists, the comparison is `UNKNOWN` — never approximated.
- **Rate representation:** fixed-point with a scale declared by the snapshot; rates are exact as given, never re-derived from inverses.
- **Unknown:** never coerced to zero, and never silently dropped from an aggregate. An aggregate containing an unknown term is itself unknown.

Both rules are in the conformance suite (AC-6).

### 7.5 Execution graph

```ts
type ExecutionGraph = {
  graphUid: string;
  metadata: ObjectMeta;
  provenance: Provenance;
  nodes: GraphNode[];
  edges: GraphEdge[];
  status: GraphStatus;
  unmetAssertions: UnmetAssertion[];
  decisionRecordRef: ContentRef;   // by reference; the record is NOT inlined
};

type GraphStatus =
  | "READY"
  | "PARTIAL"
  | "UNSATISFIABLE"
  | "AWAITING_REQUIRED_STATE"
  | "INDETERMINATE_UNDER_APPROXIMATION";

type GraphNode = {
  uid: string;
  kind: NamespacedType;        // core kinds are reserved names, not a closed enum
  spec: NodeSpec;              // compiled, immutable within a revision
  dataFlow: NodeDataFlow;      // compiled, immutable within a revision
  status: NodeStatus;          // runtime, mutated by the advance loop
};

type NodeSpec = {
  capabilityUid?: string;
  transformType?: NamespacedType;   // required when kind is core/TRANSFORM
  requestTemplate?: TypedValue;
  credentialScope?: CredentialScope;   // required when kind is core/ACQUIRE (§11.5)
  condition?: Condition;
  pendingDeadline?: EpochMicros;    // REQUIRED when condition is present
  fanOut?: FanOutSpec;              // required when kind is core/FAN_OUT
};

type NodeDataFlow = {
  inputBindings: Record<string, Binding>;
  outputSchema?: SchemaRef;
};

type NodeStatus = {
  phase: "PENDING" | "READY" | "DISPATCHED" | "SUCCEEDED" | "FAILED"
       | "INDETERMINATE" | "SKIPPED" | "EXPIRED";
  conditionValue?: "TRUE" | "FALSE" | "UNKNOWN";
  attempts: AttemptRef[];      // §11.7
  lastTransitionAt: EpochMicros;
};

type Binding = {
  source: "GOAL" | "STATE" | "NODE_OUTPUT";
  path: string;                // RFC 6901 JSON Pointer
  expectedType: SchemaRef;
};
```

**Draft 2's `GraphNode` was a flat bag mixing compiled configuration with runtime state, and it had no per-node status at all** — `GraphStatus` is graph-level, so "which node is this investigation actually waiting on" was not a question the data model could answer. The split above makes the invariant enforceable rather than conventional: `spec` and `dataFlow` are written by the compiler and immutable for the life of the revision; `status` is written by the advance loop and by nothing else. A reconciler that mutates `spec` is violating a type boundary rather than an unwritten rule.

**Bindings retain RFC 6901 pointers here, deliberately.** §7.1 replaced pointers with nominal roles at the *goal* boundary because callers do not own downstream payload schemas and their goals outlive schema refactors. Neither condition holds inside the graph: bindings are compiler-generated against schemas resolved in the same compilation, they are typechecked at compile time (§8, step 9), and they live exactly as long as the revision that created them. A pointer that is generated, validated, and discarded within one compilation cannot drift.

**`GraphStatus` now contains the two values Draft 1 used but never declared.** `INDETERMINATE_UNDER_APPROXIMATION` was defined in the solver section and required by an acceptance criterion while being absent from the enum; `AWAITING_REQUIRED_STATE` was described as a *reason* for `UNSATISFIABLE`, which conflated "cannot be done" with "not yet" — the single most consequential status distinction in the system.

**Core node kinds:** `core/ACQUIRE`, `core/GATE`, `core/FAN_OUT`, `core/JOIN`, `core/TRANSFORM`.

`core/TRANSFORM` did not exist in Draft 1, while the binding design simultaneously required that every formatting, projection, or transformation flow through an explicit typed node. The mechanism the design depended on was not representable in the data model.

`kind` is a namespaced type rather than a closed enum so that adding a node kind goes through the registry rather than gating every contributor on a core-team release.

**TransformDefinition** is a registry artifact:

```ts
type TransformDefinition = {
  name: NamespacedType;
  owner: NamespaceOwnerRef;
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  conformanceVectors: VectorSetRef;   // REQUIRED: input/output pairs, all implementations must match
  deprecation?: DeprecationRecord;
};
```

This is the direct answer to "the transform stdlib ossifies behind a closed enum": transforms are owned, versioned, deprecable, and conformance-tested like any other registry type.

### 7.5.1 Graph payload bounds

Two things in Draft 2 grew the graph object without bound, and both are now fixed by reference rather than by a size limit.

**Fan-out is a template, not materialized nodes.** A `core/FAN_OUT` node holds a `FanOutSpec { maxCardinality, itemSchema, bodyTemplate }`. The graph stores the body **once**. Per-item execution creates `NodeInstance` records — `(nodeUid, itemOrdinal, itemValueRef, status, attempts)` — in the execution store, not new `GraphNode` entries in the graph. A revision's node count is therefore a function of the *compiled plan*, not of runtime data volume, and a fan-out over ten thousand directors does not produce a ten-thousand-node graph object that every reconciliation deserializes. Idempotency keys incorporate `itemOrdinal` alongside `nodeUid` (§11.4).

**`NodeInstance` is a personal-data-bearing store and is governed as one.** A fan-out over the directors of a company binds a person to each ordinal; the item value is personal data by any reading. Two obligations follow, and Draft 3 stated neither when it introduced the record:

- **Erasure.** `itemValueRef` points into the subject's encrypted extent (§12) rather than storing the value inline, so a `NodeInstance` is shredded with its subject like any other personal fact. A store that held item values in the clear would have been an erasure bypass introduced by a payload optimization — the exact class of mistake §12 exists to prevent, reintroduced one layer down.
- **Retention.** Instance records are execution state, not audit state: what an auditor is entitled to is the decision record, which is bounded by the plan. `NodeInstance` rows are therefore subject to a policy TTL keyed on investigation terminality, independent of the audit period. Without that, the store the fan-out optimization was designed to bound grows without bound on a different axis.

`itemOrdinal` is stable for the life of the investigation and is assigned in the canonical order of the fan-out source collection, so an idempotency key derived from it is stable across replans (§11.4).

**The decision record is referenced, not inlined.** Draft 2 embedded `decisionRecord: DecisionRecord` in `ExecutionGraph` while §13 required it to carry the full candidate set with a decisive constraint per rejection — a structure that scales with the *capability population*, attached to an object the reconciler loads on every replan. It is now written to append-only content-addressed storage and referenced by digest, which is what §7.2 already does for every other large artifact. The graph is a working object on a warm path; the decision record is an audit artifact on a cold one, and Draft 2 conflated their lifetimes. Referencing it also makes the record immutable and independently retained, which §8.2 already required of Class A deployments and had no mechanism for.

### 7.6 Conditions

```ts
type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { compare: { op: "EQ" | "NEQ" | "LT" | "LTE" | "GT" | "GTE";
                 left: Binding; right: Binding | TypedValue } }
  | { defined: Binding };
```

Total, non-recursive over data, no user-defined functions, no iteration, no allocation. Maximum nesting depth is policy-bounded.

**Three-valued semantics are normative and published as truth tables.** `UNKNOWN` propagates: `all` is `FALSE` if any operand is `FALSE`, else `UNKNOWN` if any is `UNKNOWN`, else `TRUE`. `any` is `TRUE` if any operand is `TRUE`, else `UNKNOWN` if any is `UNKNOWN`, else `FALSE`. `not UNKNOWN` is `UNKNOWN`. A comparison with an unresolved binding is `UNKNOWN`. Draft 1 gave unknown propagation one informal sentence; it is the trickiest part of the semantics and the most likely source of cross-runner divergence.

A node whose condition is `UNKNOWN` remains pending — it does not default to false and does not trigger an implicit request.

**`pendingDeadline` is required.** Draft 1 gave `JOIN` an explicit timeout but gave a node pending on a permanently-`UNKNOWN` condition none. It waited forever, silently, caught only by the global wall-clock limit with no attribution. Expiry produces a typed `CONDITION_NEVER_RESOLVED` state fact naming the unresolved binding.

## 8. Deterministic Compilation

For each request, the core MUST:

1. Verify planning-context referential integrity (§7.2).
2. Canonicalize and validate all schemas, references, bindings, and state facts.
3. Resolve every assertion to its matching strategy contributions, or return a typed unhandled-assertion result.
4. Expand each contribution independently and merge fragments by conjunction (§9.3).
5. Apply policy-phase relaxations (§9.4).
6. Prove static infeasibility against the bundle's production frontier before spending budget (§10.2).
7. Filter capabilities by predicate evaluation against attribute definitions, coverage, policy, operational state, and hard constraints.
8. Select a feasible candidate set using the policy's declared objective ordering and fixed-point currency conversion.
9. Compile selected requirements and bindings into a graph; reject cycles and type-invalid data flow.
10. Emit the decision record, the read-set, and the requested level of audit information.

The policy snapshot owns objective ordering and resource budgets. Selection uses fixed-point integers and stable immutable UIDs. If candidates remain equivalent after all declared policy objectives, their canonical content digest is the final tie-breaker. This yields repeatability without depending on mutable display names or insertion order — and it is, on its own, the overwhelming majority of the determinism anyone will ever audit.

### 8.1 Determinism classes

Draft 1 required byte-identical graphs across supported platforms *and* a deterministic exact set-cover/ILP mode. Taken together that commits to writing an exact-arithmetic solver with a stability guarantee across platforms, thread counts, and years — off-the-shelf MIP solvers vary across versions, presolve, cut generation, and parallel accumulation order, and floating point is already banned. That is a larger project than the platform it was meant to support, and nothing in Draft 1 funded it.

Two classes are now defined. **Class A is mandatory. Class B is opt-in.**

**Class A — `VERIFIABLE` (required of every implementation).**
- Canonical serialization is byte-identical for a given logical object.
- Every compilation emits a `DecisionRecord`: the candidate set considered, the decisive constraint for every rejection, the selected capabilities, the objective values compared, and the read-set.
- Replay means **verifying the recorded decision against the recorded inputs**: re-checking that each recorded rejection follows from the recorded predicates and facts, and that the selected set satisfies the recorded objectives. It does not mean recomputing the search.
- The solver is a **pluggable, freely upgradable component**. Upgrading it does not invalidate historical decisions, because historical decisions are verified, not re-derived.

**Class B — `REPRODUCIBLE` (opt-in, per deployment).**
- The planner ships as a content-addressed, hermetically reproducible artifact.
- The solver operates in exact arithmetic with a published, versioned algorithm.
- A cross-platform determinism conformance suite gates releases.
- Every planner build referenced by a live investigation MUST remain executable for the audit period.

Choose Class B only when an external obligation requires recomputation rather than verification. Class A satisfies every audit requirement this RFC articulates.

### 8.2 Planner and solver versioning

Provenance that names a binary nobody can still execute is a citation, not a reproduction. Draft 1 recorded planner and solver versions and never required them to remain runnable.

- Each investigation **pins** a planner build at creation and continues on it.
- Migrating an in-flight investigation to a new planner build requires an explicit, recorded `PlannerMigration` event carrying the old and new build digests and a reason code. Migration never happens implicitly on deploy.
- Class B deployments MUST retain every pinned build as an executable artifact for the audit period; Class A deployments MUST retain the decision records, which do not depend on the build remaining executable.
- Decision-record and provenance schemas are independently versioned from the planner and are forward-compatible per §14.

### 8.3 Solver modes

Implementations MUST publish the solver algorithm and version in provenance.

- **Exact mode** establishes infeasibility and may return `UNSATISFIABLE`.
- **Approximate mode** is permitted only when the policy explicitly allows approximation. It MUST return `INDETERMINATE_UNDER_APPROXIMATION` — now a declared status value — and MUST NOT return `UNSATISFIABLE`.

## 9. Strategy Bundle Contract

A strategy bundle is a content-addressed, versioned package of contributions. It receives GoalSpec assertions and declared state facts and returns requirement fragments and graph templates.

`priority: number` is **removed**. So is the manifest-declared ordered pipeline, the phase/priority tie-break, and the duplicate-precedence publication check. None of them are needed once composition is order-independent.

### 9.1 Two contribution forms; declarative is the default

Draft 2 offered exactly one form — an imperative `expand()` compiled to Wasm — which meant that contributing a fixed mapping from an assertion type to three requirements cost a toolchain, a build, a sandbox, a fuel budget, and a hand-written production frontier. That is a real barrier for the common case, and the common case is most of them.

**Form 1 — `DeclarativeContribution` (default, no toolchain).**

```ts
type DeclarativeContribution = {
  selector: AssertionSelector;
  phase: "BASE" | "ENRICHMENT" | "POLICY_OVERLAY";
  emits: DeclarativeRule[];
};

type DeclarativeRule = {
  when?: Condition;             // §7.6 grammar, over assertion params and state facts
  requirements: RequirementTemplate[];
  relaxations?: Relaxation[];   // POLICY_OVERLAY phase only
};
```

A `RequirementTemplate` is a `Requirement` (§9.2) whose `TypedValue` leaves may be `Binding`s resolved against the assertion and the declared state facts. Evaluation is native, in-process, total, and allocation-bounded: it is a bounded walk over a finite rule table with the §7.6 evaluator, which the core already implements and already conformance-tests. There is no sandbox because there is no untrusted computation — a declarative contribution has no expressive power beyond selecting rules and substituting typed values.

Note what disappears with the toolchain: **`frontier` is not declared, it is computed.** The union of `producesEvidenceType` and emitted state-fact types across a finite rule table is a static property of the table. The linter derives it exactly, which eliminates for this form the under-declaration risk that §10.2 has to police at runtime — the frontier closure is sound by construction rather than by enforcement.

**Form 2 — `ComputedContribution` (Wasm, for contributions that genuinely compute).**

```ts
interface ComputedContribution {
  selector: AssertionSelector;
  phase: "BASE" | "ENRICHMENT" | "POLICY_OVERLAY";
  frontier: ProductionFrontier;              // §10.2, REQUIRED and enforced
  expand(input: StrategyInput): RequirementFragment;
}
```

Unchanged from Draft 2, and still the right answer for contributions that must iterate over a collection, derive a value arithmetically, or consult a domain algorithm. It keeps the full §9.5 sandbox because the reason for the sandbox — arbitrary contributor code in a shared process — is unchanged.

Both forms emit the same `RequirementFragment` and merge under the same semilattice (§9.3). A bundle may contain both. **Bundle lint reports any `ComputedContribution` whose emitted fragment is invariant across its declared inputs**, since such a contribution is a rule table that paid for a toolchain.

The panel's estimate that most strategies fit the declarative form is testable rather than assumed: §17 metrics record the form mix, and if computed contributions dominate, the declarative form is underpowered and needs a specified extension — not a quiet return to Wasm-only.

### 9.2 Fragments are constraint sets

```ts
type RequirementFragment = {
  requirements: Requirement[];
  relaxations?: Relaxation[];   // POLICY_OVERLAY phase only
};

type Requirement = {
  uid: string;                        // derived from canonical content, not assigned
  satisfiesAssertionUid: string;
  producesEvidenceType: NamespacedType;
  capabilityConstraints: Predicate[]; // conjunctive
  dataFlow?: BindingDeclaration[];
  expansionTriggers?: ExpansionTrigger[];
};
```

### 9.3 Merge is a semilattice

Merging two fragments is the union of their requirement sets keyed by content-derived `uid`, with per-requirement constraint sets unioned (conjunction).

This is idempotent, commutative, and associative. **Therefore contribution order does not exist as a concept**, and there is nothing for contributors to compete over. Two contributions that constrain the same requirement incompatibly produce an unsatisfiable constraint set, which surfaces as a typed diagnostic naming both contributing digests and the conflicting predicates — a debuggable outcome rather than a silent last-writer-wins.

This is the single change with the most leverage on contributor scale in the document.

### 9.4 Relaxation is the only override, and it also commutes

Some policy overlays genuinely need to *remove* a constraint rather than add one. That is modeled explicitly and narrowly:

```ts
type Relaxation = {
  targetRequirementUid: string;
  removesPredicateDigest: string;
  justificationCode: number;    // registered reason code
};
```

Only `POLICY_OVERLAY` contributions may emit relaxations. All relaxations are collected as a set and applied **after** the full conjunction. Set union is itself commutative and associative, so order-independence survives. Every relaxation is individually recorded in the decision record with its justification code — an override you can point at, rather than a priority number you have to reverse-engineer.

### 9.5 Execution substrate for computed contributions

`ComputedContribution` implementations execute as **Wasm modules**, with:

- no WASI clock, randomness, filesystem, or network imports — the import surface is an explicit allow-list containing none of them;
- deterministic Wasm features only (no threads, no SIMD nondeterminism, no relaxed float; float ops are unreachable because the data model has no floats);
- fuel metering with a policy-declared budget, and a deterministic out-of-fuel trap;
- a bounded, deterministic linear-memory limit.

Purity is now structural rather than a MUST that nothing checks, sandboxing is inherited rather than bolted on, and contributors may write in any language targeting Wasm.

Deployments MAY run first-party bundles in-process **only** in single-tenant deployments where the bundle and the core share a trust and release boundary. Shared or multi-tenant deployments MUST use the sandbox.

**Fuel exhaustion is a contribution-scoped diagnostic, not an investigation failure.** Fuel budgets are declared by policy per contribution class. Exhaustion traps deterministically and produces a typed `STRATEGY_FUEL_EXHAUSTED` diagnostic naming the contribution digest and the assertion being expanded; the affected assertion is reported unmet with that reason, and other contributions' fragments still merge. A budget that is too small for a legitimately expensive contribution is then a visible, attributable operational fact with an owner, rather than an investigation that fails opaquely as inputs grow. Declarative contributions have no fuel dimension: their evaluation cost is bounded by the rule table, which is fixed at publication.

**On the cost of the Wasm boundary:** contribution expansion runs on the cold path only (§11.2), once per matching contribution per replan — not per node, not per state fact, and never on the advance loop. The declarative form removes it from the common path entirely. Boundary copy cost is therefore bounded by replan frequency, which read-set invalidation already minimizes; if profiling later shows it dominating cold-path latency, the remedy is a shared-memory fragment encoding, not a change to the isolation model.

### 9.6 Contributor development loop

Draft 1 gave runner implementers a conformance suite and gave strategy authors nothing — no fixture format, no offline compile, no golden files. A contributor population cannot exist without a local loop.

Normative deliverables:

- a **fixture format** for `StrategyInput` (assertions, state facts, attribute definitions, capability fixtures) that is the same canonical encoding the core consumes;
- an **offline compiler** that runs a bundle against fixtures with no control plane, emitting the graph, the decision record, and diagnostics;
- a **golden-file harness** with stable canonical output suitable for checking into a repository;
- a **bundle lint** that runs at publication and locally: predicate typechecking, frontier honesty (§10.2), unreachable contributions, deprecated attribute use, and the invariant-computed-contribution check of §9.1.

The target is that a new contributor produces a passing strategy in under fifteen minutes without access to the control plane. **Draft 2 could not have hit that target** — fifteen minutes does not include installing a Wasm toolchain — and the declarative contribution form of §9.1 is what makes it a plan rather than a wish. For a declarative contribution the whole loop is: write a rule table, run the offline compiler against a fixture, check in the golden file.

**Contributor cost ladder.** The complexity a contributor meets should be proportional to what they are actually introducing, and the design now says explicitly where each tier begins:

| Tier | What you are adding | What it costs you |
|---|---|---|
| 0 | A mapping from an existing assertion type to existing attributes and capabilities | A declarative rule table and a golden file. No toolchain, no frontier, no fuel budget, no sandbox. |
| 1 | A contribution that must compute | Tier 0 plus a Wasm toolchain, a declared production frontier, and a fuel budget. |
| 2 | A new attribute, transform, or node kind | Tier 0/1 plus a registry artifact with an owner, conformance vectors, and a deprecation obligation. |
| 3 | A new predicate operator | A planner API version and a conformance-suite extension (§7.3). Deliberately rare. |

Nothing above tier 0 is on the path of a contributor who is not introducing new vocabulary. The ladder is a design constraint, not documentation: a change that moves work from a higher tier into tier 0 is a change worth making, and one that pushes a common case up a tier needs a stated reason.

## 10. Status, Infeasibility, and Liveness

### 10.1 Status semantics

- `READY` — every required assertion has at least one satisfiable graph path given the current context. It does not mean every request is fully bound.
- `PARTIAL` — only optional assertions are unmet.
- `AWAITING_REQUIRED_STATE` — a required assertion is unmet, but a legal graph extension could still yield the missing fact. **Non-terminal.**
- `UNSATISFIABLE` — a required assertion cannot be satisfied under any legal extension. **Terminal**, and now statically provable (§10.2).
- `INDETERMINATE_UNDER_APPROXIMATION` — an approximate solver could not establish feasibility or infeasibility.

### 10.2 Production frontier and static infeasibility

Draft 1 made `UNSATISFIABLE` terminal "only when no legal graph extension can yield the required missing fact" — reachability over an unbounded, conditionally-expanding strategy relation, which is not decidable in general. In practice it would have been approximated by the safety limits, meaning **every genuinely impossible goal burns its full time and cost budget before failing.** "Failed after 30 minutes and $40" instead of "impossible, here is why."

Every contribution MUST declare a production frontier:

```ts
type ProductionFrontier = {
  emitsEvidenceTypes: NamespacedType[];
  emitsStateFactTypes: NamespacedType[];
  consumesStateFactTypes: NamespacedType[];
};
```

The core computes a conservative closure over the bundle: the fixed point of what the bundle can *ever* emit starting from the current facts. If a required assertion's evidence type is outside that closure, the result is `UNSATISFIABLE` **at compile time, before any spending**, with the missing type named.

**The frontier must be enforced, or the closure is unsound.** A contribution that emits a requirement outside its declared frontier is rejected at runtime with a typed `FRONTIER_VIOLATION`, and the bundle lint checks declared frontiers against static analysis of emitted types at publication. Without enforcement, an under-declared frontier would let the core prove "impossible" about something possible — an unsound answer in the dangerous direction. This is the one place where the fix requires more than the frontier declaration itself.

**Declarative contributions do not declare a frontier at all.** For the §9.1 declarative form the frontier is *derived* from the rule table, exactly, at publication. There is nothing to under-declare and nothing for `FRONTIER_VIOLATION` to catch, because the closure is computed from the same artifact that produces the requirements. Hand-declaration and runtime enforcement survive only for `ComputedContribution`, where the emitted set is not statically knowable.

This is the answer to "a strategy whose declared frontier misses one output type breaks in production with `FRONTIER_VIOLATION`": for most contributions the declaration no longer exists to get wrong, and for the rest the lint catches the mismatch at publication rather than in production. The residual runtime check is a backstop against a computed contribution whose emitted types are not statically decidable — the case it was always for.

### 10.3 Safety limits

Configurable limits apply to graph revisions, wall time, cost, fan-out, retries, condition-pending deadlines, and Wasm fuel. Each terminates with an explicit policy reason code. Limits remain a backstop; they are no longer the primary infeasibility mechanism.

## 11. Control Plane, Reconciliation, and Execution

```text
GoalSpec --> Goal API --> Reconciler ==> Advance Loop (hot)  --> Executor
                              |                                     |
                              +=====> Replan Loop (cold) --> Compiler
                              ^                                     |
Capability Control Plane --> Context Resolver                       v
        ^                                              Durable Event Log + Blob Plane
        |
Policy / health / quota (per-resource versioned)
```

The control plane owns mutable infrastructure state. **The compiler never queries it.** This remains the best structural decision in the design and is unchanged.

### 11.1 Durable execution substrate requirements

The execution layer MUST be built on a substrate providing: durable timers, at-least-once task delivery with durable checkpointing, exactly-once *effect* semantics via the idempotency protocol in §11.4, optimistic-concurrency-controlled state transitions, and an append-only event history. This RFC specifies the required properties and the planner's contract with them. It does not specify their implementation, and implementers are strongly discouraged from writing one.

The genuinely novel contribution of this project is the compiler. The workflow engine is not.

### 11.2 Two loops, not one

Draft 1 ran a single windowed loop in which *any* relevant event — including a binding resolving, the most common event in the system — triggered full compilation, at most once per reconciliation window. A sequential chain of ten nodes with a 500ms window therefore paid five seconds of planning latency for zero planning work.

**Advance loop (hot path).** On a state fact arriving: re-evaluate pending bindings and conditions, schedule newly-ready nodes. Pure graph evaluation. No solver, no strategy invocation, no window. Milliseconds. This handles the large majority of events.

**Replan loop (cold path).** Runs compilation. Triggered **only by read-set invalidation**: a resource in the revision's read-set advanced its version or passed `validUntil`, a policy or exchange-rate binding revision changed, or a strategy-declared expansion trigger fired. Windowed and coalesced, with an exemption for urgent policy revocation.

Read-set invalidation replaces Draft 1's four hand-written relevance rules. Those rules were an ad-hoc reimplementation of read-set invalidation, and each was a place where a missed case meant an investigation stalled forever with no alarm — the worst failure mode in the system, because an idle investigation looks exactly like a healthy waiting one.

**One refinement beyond a pure resource read-set:** strategies expand conditionally on runtime *values*, not only on resource versions. The read-set therefore records **state-fact addresses and versions** alongside operational resources, and the sandbox records which facts a contribution actually read. Value-level reads are part of the read-set, so expansion triggers are subsumed rather than left as a parallel mechanism.

### 11.3 Revision serialization

The reconciler serializes revision creation per investigation UID using optimistic concurrency on the previous revision digest. Concurrent workers may execute independent nodes; only one winning reconciliation publishes the next revision. Losers reload the winner and re-evaluate invalidation. Historical revisions are never rewritten.

**What this does and does not give you.** Per-investigation OCC totally orders *revision publication*, so there is no split-brain over which revision is current, and the decision stream is single-writer by construction. What Draft 2 left undefined is the fate of an attempt that is already **in flight at a provider** when the next revision publishes. Ordering the decision stream does not help there, and neither would a stricter execution model: once a request is at a third-party provider, no amount of sequencing on our side recalls it. The gap is an **attempt lifecycle**, and §11.7 supplies one.

### 11.4 Idempotency: the mechanism, not the assertion

Draft 1 asserted that duplicate state events do not cause duplicate side effects and then delegated idempotency keys to the executor, which had no basis on which to derive a stable one. An executor that crashes after invoking a provider and before appending the outcome will re-invoke. In a system that models money to the micro, that is the bug that matters.

**Key derivation is normative and happens in the graph, not the executor:**

```
idempotencyKey = H( investigationUid
                  || nodeUid
                  || itemOrdinal            // 0 for non-fan-out nodes
                  || idempotencyDigest(resolvedRequest)
                  || attemptOrdinal )
```

Note the derivation deliberately **excludes `revision`**. Keying on revision would mint a fresh key whenever an unrelated replan bumped the revision, permitting a duplicate paid call for identical work — which is the exact failure the key exists to prevent. Keying on the request means the key is stable precisely when the work is.

**`idempotencyDigest` is over a declared projection, not the whole request.** Request schemas mark each field `idempotencyRelevant: true | false`; the digest covers only the relevant fields, canonically serialized. Draft 2 digested the entire resolved request, which made the key sensitive to fields that carry no semantic weight — a timeout default, a trace identifier, a client hint added in an additive, backward-compatible schema revision. Any of those would have minted a new key for identical work and permitted a duplicate paid call. Relevance is declared once by the schema owner and is itself a versioned, reviewable property.

**The annotation defaults to `true`, and the default is not arbitrary.** An unannotated field is idempotency-relevant. The projection introduces one new way to be wrong — mis-annotating a semantically load-bearing field as irrelevant — and the two error directions are not symmetric:

- A semantic field wrongly excluded → a re-dispatch with a corrected parameter collides with the prior key → a `KEYED` provider returns **the old answer to the new question**. Silently wrong evidence, fully verifying provenance, no signal.
- A non-semantic field wrongly included → a duplicate paid call. Costly, but it appears in cost metrics, in the provider's records, and in the attempt log.

The second is recoverable and detectable; the first is neither. Defaulting to inclusion means a schema author who forgets the annotation on a new field gets the loud failure, never the quiet one — the same reasoning that puts `TREAT_AS_UNKNOWN` on `AttributeDefinition` (§7.3) rather than a coerced default.

Three further controls, because "declare it correctly" is not a mechanism:

- Marking a field `idempotencyRelevant: false` requires a registered justification code, so exclusions are reviewable as a set rather than scattered across schema files.
- Flipping a field from `true` to `false` is a **breaking change** requiring a new schema version — it silently widens the set of requests that collide on one key, and additive-compatibility rules (§14) would otherwise let it ship as a minor revision.
- Schema lint flags any excluded field that appears in a binding target, since a field the graph computes per-node is by construction not a constant client hint.

**Why not key on business identifiers instead.** The proposal to key on `(investigationUid, nodeUid, subjectIdentifier)` and drop the request digest entirely fixes stability by making the key blind to what is being asked. That trades a duplicate-charge failure for a wrong-evidence failure: a node re-dispatched with a corrected date range, a different document type, or a repaired parameter would collide with the previous call's key, and a `KEYED` provider would faithfully return the **old response to the new question**. The system would then record, cite, and reason over evidence that does not answer the request in its provenance, with every digest verifying. In a platform whose entire purpose is auditable evidence, silently wrong evidence is a worse outcome than a duplicate charge, and it is much harder to detect.

The declared projection gets the stability the critique is after without giving up content-sensitivity: the key changes when the question changes, and only then.

**Write-ahead intent protocol:**

1. Append `NodeAttemptIntent { key, capabilityUid, requestDigest, attemptOrdinal }`.
2. Invoke the provider with the key.
3. Append `NodeAttemptOutcome { key, result | failure }`.

On recovery, every orphaned `Intent` is reconciled before any new attempt. Reconciliation depends on a capability's declared idempotency support, which is now part of the capability schema:

- `KEYED` — the provider honors idempotency keys. Re-issue with the same key, or query by key.
- `NATURAL` — the operation is naturally idempotent (a pure read). Re-issue freely.
- `NONE` — the provider offers neither. **Fail closed:** mark the attempt `INDETERMINATE`, emit a typed state fact, and resolve it under the capability's declared `IndeterminateResolution` policy. Never blind-retry.

The `NONE` case is why "just use idempotency keys" is not by itself a complete answer: some providers cannot support them, and the honest design surfaces that as a policy decision rather than hiding it behind a retry.

**Fail-closed does not mean page a human every time.** Draft 2 said policy decides "whether to escalate to a human or abandon the branch," which reads as a per-incident human decision — and a per-incident human decision on a transient provider blip is an alert queue nobody can staff. Resolution is declared **in advance, per capability**, and applied automatically:

```ts
type IndeterminateResolution =
  | { mode: "ABANDON_BRANCH" }
  | { mode: "ASSUME_NOT_APPLIED"; justificationCode: number }   // safe only for free/reversible effects
  | { mode: "ESCALATE"; escalationClass: string };
```

`ESCALATE` remains the default for capabilities with irreversible or billed effects, because for those the decision genuinely is a judgment call and pretending otherwise is how duplicate charges get automated. But a free read against a provider with no key support resolves as `ASSUME_NOT_APPLIED` without waking anyone, and the resolution mode is recorded in the decision record either way. The pager load becomes a property of the capability catalogue — visible, attributable, and reducible by fixing or replacing the offending capability — instead of an emergent property of production.

### 11.5 Workflow executor

The executor receives scheduled nodes, resolves only validated bindings, invokes provider adapters, validates output against declared schemas, and appends immutable state events. It MUST NOT choose alternate providers, alter a request template, or silently retry outside graph and policy rules. Failure is a state fact for the next reconciliation.

**Policy enforcement gets a mechanism.** Draft 1 assigned the executor enforcement of data classification and policy while the graph carried no credential scoping model — a duty with no means, and the layer where a policy bypass would actually occur. Each `core/ACQUIRE` node now carries a `CredentialScope`: the credential class, the permitted data classifications, the permitted egress destinations, and the tenant. The executor obtains credentials only through a broker that validates the scope against the graph revision's policy digest and refuses to issue outside it. The executor cannot widen its own scope, because it never holds an unscoped credential.

Fan-out nodes declare maximum cardinality and item schema. Join nodes declare completion semantics (`ALL`, `ANY`, `QUORUM`) and an explicit timeout outcome.

### 11.6 Re-planning and failure

Re-planning creates a new immutable revision. The reconciler may select a different capability in a later revision only because the new context or policy allows it, and the decision record MUST identify the changed read-set entry. Fallback is graph structure or policy-approved recompilation, never hidden executor behavior.

### 11.7 Attempt lifecycle across revision boundaries

Draft 2 had a genuine hole here, and it is worth stating precisely because the obvious fix does not close it.

The scenario: the advance loop dispatches node X under revision *N*. While that provider call is outstanding, the replan loop publishes revision *N+1*. Draft 2 said nothing about what happens to the in-flight attempt, which means an effect authorized by a superseded revision could return and satisfy a node in its successor — or, worse, be silently re-dispatched because *N+1*'s copy of the node looks unstarted.

**Why sequencing does not fix it.** The proposed remedy — a single-threaded actor or workflow instance per investigation, with all events through one queue — makes the *decision* stream serial. §11.3 already achieves that with per-investigation OCC. But neither serializes the thing that actually matters: an HTTP request already at a third-party provider is not inside our event loop, and processing the replan event "after" the dispatch event does not un-send it. A strict actor loop would additionally serialize the hot path behind cold-path compilation, reintroducing exactly the latency §11.2 exists to remove and that AC-14 forbids. The problem is not event ordering; it is that attempts had no defined state across revisions.

**Every attempt records the revision that authorized it**, and revision publication classifies each in-flight attempt exactly once:

```ts
type AttemptDisposition =
  | "CARRIED"     // node uid + itemOrdinal + idempotencyDigest identical in the new revision
  | "ORPHANED"    // node absent, or its idempotency projection changed
  | "QUIESCED";   // dispatch withheld pending the boundary; see below
```

- **`CARRIED`.** The new revision wants precisely this work, and the idempotency key is by construction identical (§11.4 excludes `revision` from the key — this is the case that exclusion was designed for). The attempt carries forward unchanged. **No new dispatch occurs and no duplicate effect is possible.** The outcome, whenever it arrives, applies to the new revision.
- **`ORPHANED`.** The new revision does not want this work, or wants materially different work. The outcome is still recorded — the effect happened, the money was spent, and an audit log that omits it is false — as an `OrphanedAttemptOutcome` carrying the authorizing revision. It is **inadmissible as evidence**: it MUST NOT satisfy any node, resolve any binding, or discharge any assertion in the new revision. A typed `ORPHANED_ATTEMPT` state fact is emitted for cost accounting and metrics. This is the specific leak the review identified, and inadmissibility is what closes it.
- **`QUIESCED`.** For capabilities declaring `idempotencySupport: NONE`, dispatch is **withheld while a replan is pending for that node**. This is the narrow case where the reviewer's serialization instinct is correct: without keys there is no way to make a duplicate harmless after the fact, so the only remedy is not to create one. Quiescence is scoped to non-idempotent nodes during a pending replan — not to the whole investigation, and not to the hot path in general.

Orphan rate is a first-class metric (§13). A persistently high rate means replans are racing dispatch, which is a tuning problem in the replan window with a visible signal, rather than an invisible correctness problem.

**This preserves the two-loop split.** The hot path stays free of compilation and keeps its millisecond budget; the cold path keeps its coalescing window; and the boundary between them is now governed by an explicit protocol instead of an unstated assumption. Correctness comes from attempt disposition and idempotency keys, which hold regardless of concurrency, rather than from a global ordering discipline that would have to be maintained forever and would cost the latency property outright.

## 12. Evidence Data Plane and Erasure

Draft 1 had no evidence data plane at all. Acquisition outputs became "typed state facts," and real evidence — documents, PDFs, images — had nowhere to live except the immutable event log, which would have made that log a multi-terabyte blob store that every reconciliation reads past.

Draft 1 also required logs to be immutable or tamper-evident for the audit period, on a platform holding personal data about identifiable people, without mentioning erasure. Immutability and erasure obligations are in direct conflict; that conflict does not resolve itself, and it is not retrofittable.

**Design:**

- Evidence bytes live in a **content-addressed blob store**, never in the event log.
- The event log stores an `EvidenceRef { blobDigest, sizeBytes, mediaType, classification, subjectKeyRef }`.
- Blobs are encrypted under a **per-subject data key**, derived rather than individually minted (see below).
- **Erasure destroys the subject's data key.** The hash chain remains intact, tamper-evidence remains intact, provenance digests remain verifiable, and the bytes are unrecoverable.

**Key derivation: HKDF with a per-subject random salt.** A KMS call per subject does not scale to millions of subjects — the cost and the rate limits are both real, and batch erasure is where the throttling would land. Subject keys are therefore derived:

```
subjectKey = HKDF( ikm  = tenantKeyRingSecret,      // unwrapped from KMS once per key-ring epoch, cached
                   salt = subjectSalt,               // 256-bit random, stored in the shreddable key table
                   info = tenant || subjectId || keyRingEpoch )
```

KMS is invoked per **key-ring epoch**, not per subject and never per blob. Erasure deletes the subject's salt row, and the key becomes underivable.

**The random salt is load-bearing and must not be optimized away.** Deriving subject keys *deterministically* from a tenant master key — HKDF over subject identifiers alone, with no stored per-subject secret — reduces KMS cost identically and **silently destroys the erasure property**: anyone holding the tenant key ring can re-derive any subject's key at any time, including after the "erasure," so no key was ever actually destroyed. Crypto-shredding requires that some *unrecoverable* secret be destroyed, and under fully deterministic derivation there is no such secret. The salt is that secret. This is the difference between erasure and the appearance of erasure, and it does not show up in any test that does not model an adversary holding the master key.

Two operational consequences follow. Salt rows are the **only** irreplaceable state in the evidence plane, so they are replicated on a schedule that treats deletion as authoritative. And salts are stored in a partition separate from the ciphertext, so that a bulk erasure is a bounded set of row deletions rather than a scan over the blob store.

**Erasure is journaled, and restore is filtered through the journal.** A backup that restores a shredded salt un-erases the subject, and it does so silently, with every digest still verifying and no signal anywhere in the system. Stating that hazard is not a control, so:

- Every erasure appends an `ErasureTombstone { tenant, subjectId, erasedAt, requestRef }` to an append-only **erasure journal** held in a separate failure domain from the salt partition, with its own retention governed by the compliance obligation rather than by the backup schedule.
- Any restore of the salt partition MUST be filtered through the journal: a salt whose subject has a tombstone is dropped, not restored. This is a precondition of the restore completing, not a cleanup job scheduled after it.
- The journal is never restored *from* the salt partition's backups, which is what keeps the filter meaningful — a restore that recovered both together would recover the thing it is supposed to be checked against.
- A reconciliation job asserts the invariant continuously: no live salt row exists for any tombstoned subject. Violations are a compliance incident, alarmed, not a metric.

The tombstone contains no personal data beyond the subject identifier already present in the erasure request, and the identifier is itself pseudonymous where policy requires — a journal designed to enforce erasure should not become the one record that survives it.
- Typed state facts that themselves contain personal data are stored in per-subject encrypted extents under the same key and are erased with it. Facts are classified at schema-registration time, so classification is not a per-write judgment call.
- Reads of erased content return a typed `ERASED` marker with the erasure event reference.

**Stated honestly:** erasure and full replay are mutually exclusive for an erased subject, by construction. What survives erasure is the *audit* — the decision record's reason codes, digests, capability selections, and structure, none of which contain personal data. What does not survive is the ability to recompute a decision from the erased inputs. Crypto-shredding buys tamper-evidence plus erasure; it does not buy erasure plus recomputation, and no design does. Class B deployments must reconcile their recomputation obligation with their erasure obligation explicitly, per data classification, in policy.

## 13. Provenance, Audit, and Operations

Every graph revision MUST record: the GoalSpec digest; the `PlanningContext` integrity digest; the full read-set with versions and validity bounds; the strategy bundle digest and per-contribution digests; the planner build digest and solver algorithm/version; selected capability UIDs; every applied relaxation with its justification code; and the decision-record schema version.

**The decision record is the authoritative artifact**, not a byproduct. It contains the candidate set, the decisive constraint for each rejection, the objective comparisons that produced the selection, the read-set, and — see below — the **witnessed values** those decisions turned on. It is the thing that makes Class A determinism sufficient, and it is the single element of this RFC that is not retrofittable — everything else can be added behind it later.

**Witnessed values are part of the record, not a lookup against the fact store.** A read-set entry is a `(resource, version, validUntil)` identifier. Identifiers alone are not sufficient to verify a recorded decision: re-checking that a rejection follows from its recorded predicate (§8.1, Class A) requires the *attribute values* the predicate was evaluated against. A record that cites `capability-7 @ v42` and asserts "rejected: jurisdiction not in {DE, FR}" is only verifiable if v42's jurisdiction value is recoverable — and if verification has to fetch it from the live fact store, then fact retention silently becomes an audit-period obligation and §7.2's independence claim is false.

The decision record therefore embeds a `WitnessSet`: for every predicate evaluation that contributed to a rejection, a selection, or an `UNKNOWN` admissibility determination, the attribute value observed and its source read-set entry. Scope is deliberately narrow — values that no decision turned on are not witnessed, so the set is bounded by the *decision*, not by the fact population.

Draft 3 asserted this property in §7.2 while §13 listed only the read-set. The claim was right and the mechanism was missing; this is the mechanism.

**Witnessed values inherit classification.** A witnessed value carrying personal data is stored in the subject's encrypted extent (§12) like any other personal fact, and is erased with the subject. Verification of an erased subject's decision then degrades to structure, reason codes, and digests — exactly the boundary §12 already states, now reached by an explicit path rather than by accident.

`traceLevel`:

- `NONE` — provenance and status only.
- `SUMMARY` — decision record, unmet assertions, graph edges.
- `VERBOSE_AUDIT` — bounded per-candidate evaluation records, emitted to an external audit sink.

Audit records use **namespaced reason codes** with registry-declared ownership and a reserved core range. Draft 1 required all reason codes to be centrally registered numerics — right for stability, but a central bottleneck once many namespaces contribute. Namespacing keeps stability without a single approval queue.

Records MUST NOT contain credentials, raw evidence, or arbitrary goal/state maps. Implementations MUST enforce configured candidate and byte limits and report truncation explicitly.

Audit delivery is asynchronous and backpressure-aware, with a bounded durable queue and explicit outcomes: accepted, delayed, truncated, unavailable. A sink outage MUST NOT retain unbounded in-memory traces. Policy determines whether unavailable verbose audit blocks execution; summary provenance and state events remain durable preconditions for execution when compliance requires them.

**Two tiers, and only one of them is droppable.** Draft 2 stated the tiering but did not name the consequence, and the natural misreading — that backpressure can leave a compliance investigation with an incomplete trail — is worth foreclosing explicitly:

| Tier | Contents | Under backpressure |
|---|---|---|
| **Compliance** | Decision record, provenance, read-set, applied relaxations, state events | **Never dropped.** Written to content-addressed storage as a durable precondition of execution (§7.5.1). Sink unavailability stalls execution rather than proceeding unrecorded, where policy so requires. |
| **Diagnostic** | `VERBOSE_AUDIT` per-candidate evaluation records | Droppable, with an explicit `TRUNCATED` marker naming what was elided and how much. |

The compliance tier is what an auditor or a regulator is entitled to, and it is bounded by the size of the *plan*, not by traffic volume — which is why it can be a hard durability requirement without threatening dataplane stability. It is also freely **cold-archivable**: records are content-addressed and verification is offline and self-contained (§13, witnessed values), so moving them to cold storage after a policy-declared warm period costs retrieval latency on an audit request and nothing else. Non-droppable is a durability requirement, not a storage-tier requirement, and the two get conflated into a much larger bill than the design requires. The diagnostic tier is bounded by the size of the *candidate population* and exists for engineers debugging a selection; losing a window of it under load degrades debuggability, not compliance. Conflating the two would force a choice between dropping evidence and taking down execution, and the tiering exists precisely so that choice never has to be made.

Shipping the diagnostic tier out-of-band — a sidecar writing columnar storage, for instance — is a sound deployment topology and is compatible with this contract, but it is not normative: the contract is the bounded queue and the explicit outcome, which any transport must honor.

Metrics SHOULD include reconciliation count by loop (advance vs. replan), compile time, unsatisfiable and indeterminate reasons, static-infeasibility hits, node outcomes, orphaned intents reconciled, policy-denied work, trace truncation, **fact staleness against `validUntil`**, condition-pending expiries, and resource-budget exhaustion by tenant. Metrics must not include raw evidence or sensitive bound values.

Three further metrics exist because a design decision in this document depends on them, and each has a stated threshold that reopens that decision:

- **Attempt disposition rate** (`CARRIED` / `ORPHANED` / `QUIESCED`, §11.7). A sustained orphan rate above 1% of dispatches means replans are racing dispatch and the replan window needs tuning.
- **Contribution form mix** (declarative vs. computed, §9.1). If computed contributions exceed 40% of published contributions, the declarative form is underpowered and needs a specified extension.
- **Transform chain depth and single-consumer transform share** (§17.3). These are the two quantities in the CEL adoption trigger, and they are only a trigger if something measures them.

## 14. Compatibility, Version Skew, and Security

Schema evolution follows protobuf-style compatibility: new fields optional, enum values never renumbered or reused, semantic changes require a new versioned type. Unknown required versions are rejected.

**Compatibility set.** Five independent version streams now exist — assertion types, strategy interface, capability schemas, attribute definitions, and planner API — and Draft 1 said nothing about which combinations are legal. A `CompatibilitySet` is a registry artifact declaring a validated combination. Bundle publication validates against it, and an investigation records the compatibility set it ran under. Version skew is otherwise a guaranteed three-year failure with no detection point.

**Deprecation.** Registry types carry deprecation records with a status ladder (`ACTIVE` → `DEPRECATED` → `SUNSET` → `WITHDRAWN`), a required replacement pointer, and a namespace-ownership transfer procedure for abandoned namespaces. A registry without a story for the type whose owner went dark accumulates undeletable dead types.

**Security.** The control plane authorizes who may submit GoalSpecs, publish capabilities, and read each graph or audit revision, all scoped by tenant. Capability publishers cannot grant themselves access to a data classification; policy is independently administered. Snapshot records and state events are immutable or tamper-evident for the configured audit period, subject to §12 erasure.

## 15. Acceptance Criteria

1. **(Class A)** Equivalent canonical inputs produce byte-identical canonical serializations, and a recorded decision record verifies against its recorded read-set on any supported platform. **(Class B, opt-in)** the same inputs additionally re-derive an identical graph on a pinned planner build across supported platforms.
2. Reordering entries or changing a display name in a capability snapshot does not affect selection.
3. JSON Pointer bindings resolve identically in every supported runner language.
4. Predicate evaluation and condition three-valued semantics produce identical results in every supported language against the conformance suite.
5. A downstream node consumes a typed output binding from an upstream node without pre-rendering that request.
6. Cross-currency choices replay from the recorded fixed-point exchange-rate snapshot, and two independent implementations agree to the micro on half-even rounding and triangulated conversion.
7. A composite GoalSpec produces independently traceable graph fragments from more than one contribution.
8. **Fragment merge is order-independent:** any permutation of matching contributions produces an identical fragment set, and a conflicting pair produces a diagnostic naming both digests.
9. An approximate solver returns `INDETERMINATE_UNDER_APPROXIMATION` and never `UNSATISFIABLE` without a proof-capable result.
10. A goal whose required evidence type lies outside the bundle's frontier closure returns `UNSATISFIABLE` **before any provider is invoked and before any budget is consumed**.
11. A contribution emitting outside its declared frontier is rejected with `FRONTIER_VIOLATION`.
12. **An executor crash between provider invocation and outcome append produces exactly one provider effect** for `KEYED` and `NATURAL` capabilities, and exactly one `INDETERMINATE` outcome requiring policy resolution for `NONE`.
13. A provider failure cannot cause an unplanned fallback request.
14. A binding resolving on a sequential chain advances through the hot path with **no compilation**, and end-to-end latency for an N-hop chain does not scale with the reconciliation window.
15. A read-set entry advancing or expiring triggers exactly one replan; an event touching nothing in the read-set triggers none.
16. A node pending on a permanently-unknown condition terminates at `pendingDeadline` with `CONDITION_NEVER_RESOLVED` naming the unresolved binding.
17. Reconciliation stops deterministically at configured safety limits.
18. `VERBOSE_AUDIT` cannot exceed configured bounds or expose prohibited fields; audit-sink backpressure cannot create an unbounded in-memory queue.
19. A capability health or quota change produces a new resource version, not a mutation of a historical graph revision.
20. **Erasing a subject destroys all evidence and personal state facts for that subject while the event-log hash chain and every provenance digest still verify.**
21. A strategy attempting a clock, randomness, or network import fails to instantiate; a runaway strategy traps deterministically on fuel exhaustion, and the failure is attributed to the contribution without failing unrelated assertions.
22. A tenant cannot consume another tenant's `concurrencySlots` share.
23. **A revision published while a node attempt is in flight produces exactly one of `CARRIED`, `ORPHANED`, or `QUIESCED` for that attempt.** A `CARRIED` attempt issues no second provider call. An `ORPHANED` attempt's outcome is recorded and cost-accounted but cannot satisfy a node, resolve a binding, or discharge an assertion in the new revision.
24. A node whose capability declares `idempotencySupport: NONE` is not dispatched while a replan is pending for that node.
25. An additive, backward-compatible request-schema change that touches no `idempotencyRelevant` field does not change the idempotency key; changing any `idempotencyRelevant` field does change it.
26. A declarative contribution compiles, evaluates, and merges without a Wasm runtime present, and its production frontier is derived by the linter and matches the frontier computed at runtime from its emissions.
27. A goal referencing an `outputRole` not declared by the target assertion type is rejected at admission with the declared role set named; a payload schema refactor that preserves declared roles does not invalidate a stored goal.
28. **Erasure holds against an adversary in possession of the tenant key ring**: after a subject's salt is destroyed, the subject key is not derivable from the key ring and any other retained state.
29. A fan-out over N items produces one `GraphNode` and N `NodeInstance` records; graph object size is independent of N. Erasing a subject named in a fan-out item renders that `NodeInstance`'s item value unrecoverable.
30. Audit-sink unavailability never drops a compliance-tier record; diagnostic-tier loss is reported with an explicit `TRUNCATED` marker naming what was elided.
31. **A recorded decision verifies with the live operational fact store unavailable or purged**, using only the decision record's read-set and witnessed values.
32. A request-schema field added without an `idempotencyRelevant` annotation is treated as relevant and changes the idempotency key; flipping an existing field from `true` to `false` is rejected without a new schema version.
33. Restoring a salt-partition backup that predates an erasure does not restore the erased subject's salt; the reconciliation invariant reports zero live salts for tombstoned subjects.
34. A goal submitted against a `WITHDRAWN` assertion type is rejected naming its last replacement; a goal against a type deprecated through a chain of renames resolves within the hop bound and records both endpoints in provenance.

## 16. Delivery Phasing

This RFC specifies a schema registry, a control plane, a conformance-tested solver regime, a sandboxed strategy substrate, a backpressure protocol, and an erasure-capable data plane. Building all of it before integrating a single provider is 18–24 months to the first useful investigation, with the requirement algebra unvalidated against the domain the whole time. That ordering is a mistake, and the design does not require it.

**Phase 0 — walking skeleton (~6–8 weeks).**
`GoalSpec → declarative contributions → predicate-based capability match → deterministic tuple sort with digest tie-break → durable execution engine → decision record.`
No ILP. No content-addressed operational snapshots. No Class B determinism. No Wasm sandbox and **no computed contributions at all** — Phase 0 ships the §9.1 declarative form only, which is now the default form rather than a concession. §8's tuple sort with the digest tie-break is already 95% of auditable determinism.

**Phase 0 nonetheless builds these four at full rigor, because they are the expensive retrofits:**
1. The **`AttributeDefinition` registry and predicate language** (§7.3). Get this wrong and every strategy and capability written in the interim is rewritten.
2. **Idempotency keys, the declared idempotency projection, and the intent/outcome protocol** (§11.4). Retrofitting exactly-once onto a system with live provider integrations means auditing every adapter — and retrofitting the *projection* later means re-keying live work.
3. **Crypto-shredded evidence storage with per-subject salts** (§12). Retrofitting erasure onto an append-only log under legal deadline is a re-architecture. The salt table in particular must exist from the first blob written; there is no way to shred data that was encrypted before the salt existed.
4. **Attempt disposition** (§11.7). Cheap to build alongside the intent/outcome protocol, since both key off the same attempt record; expensive to add once orphaned outcomes are already in the evidence store, because reclassifying historical attempts is a data-correctness project rather than a code change.

Plus the **decision record** (§13) itself, which is not optional at any phase: everything else in this RFC is retrofittable behind it, and nothing is retrofittable without it.

**Phase 1 — contributor readiness.** Wasm substrate and computed contributions, contributor dev loop and golden-file harness, frontier closure and static infeasibility, read-set invalidation, split advance/replan loops, compatibility sets.

Note the ordering consequence of §9.1: the split advance/replan loops are a **Phase 1** optimization, so Phase 0 runs a single loop and has no revision boundary to race. Attempt disposition is built in Phase 0 anyway, per item 4, but it is not load-bearing until Phase 1 introduces concurrent replan.

**Phase 2 — scale and assurance.** Exact solver and Class B determinism *if and only if* an external obligation demands recomputation; verbose audit sink at volume; multi-tenant share enforcement; registry federation.

## 17. Draft 2 Review Disposition

### 17.1 Accepted in full

| # | Change | Where |
|---|---|---|
| 1 | Read-set provenance; per-resource versioning for operational facts; deletes the four relevance rules | §5.5, §7.2, §11.2 |
| 2 | Decision-record replay; solver pluggable and upgradable | §5.10, §8.1, §13 |
| 3 | Semilattice fragment composition; `priority` removed; typed relaxation operator | §5.6, §9.2–9.4 |
| 4 | First-class `AttributeDefinition` registry and predicate conformance suite | §5.8, §7.3 |
| 5 | Wasm strategy substrate, no clock/random/network, fuel-metered; plus the missing dev loop | §5.7, §9.5, §9.6 |
| 7 | Split readiness advance from replan | §11.2 |
| 8 | Node-derived idempotency keys and intent/outcome write-ahead | §11.4 |
| 9 | Declared production frontier and static infeasibility | §10.2 |
| 10 | Blob store and crypto-shredding for evidence | §12 |
| 11 | Unified `PlanningContext` with referential integrity | §7.2 |
| — | All eleven defects in the review's defect list | §7.1, §7.4, §7.5, §7.6, §6, §10.1, §11.4 |
| — | Phasing: build the 80% system first | §16 |
| — | Durable execution: build on a substrate, don't respecify one | §4, §11.1 |
| — | Namespaced reason codes instead of a central numeric registry | §13 |
| — | Deprecation ladder and abandoned-namespace transfer | §14 |

### 17.2 Accepted with modification

**Global snapshots (#1, partial).** Operational facts move to per-resource versioning. **Capability and policy artifacts stay whole-artifact content-addressed.** They are slow-changing, so they do not produce the cardinality bomb, and "which policy was in force at this decision" must be answerable as one citable artifact rather than reassembled from fragments. The churn argument is entirely correct about operational state and does not apply to policy.

**Read-set scope (#1, extended).** A read-set over resource versions alone does not subsume the strategy expansion triggers, because strategies expand on runtime *values*, not just resource versions. §11.2 therefore records state-fact addresses and versions in the read-set and has the sandbox record value-level reads. With that extension the claim holds and the triggers do disappear; without it, a value-dependent expansion would silently never fire.

**Idempotency key derivation (#8, corrected).** The proposed `(graphUid, revision, nodeUid, attempt)` includes `revision`, which changes on every replan — so an unrelated policy change would mint a new key for identical pending work and permit exactly the duplicate paid call the key exists to prevent. §11.4 keys on `(investigationUid, nodeUid, itemOrdinal, idempotencyDigest(resolvedRequest), attemptOrdinal)` instead: stable precisely when the work is. Additionally, not every provider supports keys, so capability schemas declare `KEYED | NATURAL | NONE` and the `NONE` path fails closed to a policy decision rather than pretending the guarantee is universal. *(Draft 3 narrows the digest to a declared idempotency-relevant projection, per §5.14 and §18.2.)*

**Production frontier (#9, hardened).** A declared frontier alone yields an *unsound* closure: an under-declared frontier lets the core prove "impossible" about something possible. §10.2 adds runtime `FRONTIER_VIOLATION` enforcement and publication-time lint, without which the static infeasibility proof cannot be trusted in the direction that matters.

**Crypto-shredding (#10, scoped honestly).** Adopted, but §12 states plainly that erasure and recomputation are mutually exclusive for an erased subject. Crypto-shredding buys tamper-evidence *plus* erasure; it does not buy erasure *plus* replay, and describing it as satisfying "both properties" without that qualification would set up the same collision one layer down.

### 17.3 Defended, with the reasoning stated

**CEL is deferred; the condition grammar and transform registry are adopted instead (#6, partial).**

The critique lands squarely on two things and I have fixed both: `Expression` was undefined while the document claimed to have no expression language (§7.6 now defines it, with published three-valued truth tables and a conformance suite), and a closed node-kind enum would have gated every contributor on a core-team release (§7.5 opens `kind` to namespaced registry types and makes `TransformDefinition` an owned, versioned, conformance-tested artifact with deprecation).

What remains is composition: CEL lets you nest expressions where this design chains typed nodes. That is genuinely better ergonomics and genuinely worse auditability, and auditability is the property this platform exists to provide. A chain of typed transform nodes has a per-step recorded output, a schema at every boundary, and a decision record that can point at the step that produced a wrong value. A nested CEL expression is one opaque evaluation.

The "Kubernetes walked this path, skip the middle decade" argument is about *accumulated special cases in an ungoverned mechanism*. The governance — registry ownership, versioning, deprecation, mandatory conformance vectors — is what actually prevents that decade, and it is now in the design. The nesting syntax is not.

**Explicit adoption trigger, so this is a decision and not an evasion:** if either (a) the median acquisition path exceeds five chained transform nodes, or (b) more than 30% of registered transform types are single-consumer compositions of existing transforms, the design has demonstrated that the composition gap is real, and CEL is adopted as `core/EXPRESSION` with the three-valued semantics already specified in §7.6. Recording that trigger now means the decision gets revisited on evidence rather than on whoever is loudest in year two.

**The trigger schedules a decision; it does not execute one.** Crossing a threshold obliges an RFC amendment with a migration plan for existing transform chains — it does not cause a running engine to begin accepting `core/EXPRESSION`, and no implementation should ship a mechanism that self-adopts a new node kind on a metric. The metric identifies when the argument has been settled by evidence; adopting an expression language into an audited planner remains a reviewed change with a version, a conformance suite, and a compatibility set.

**Class B determinism is retained as an opt-in rather than deleted.** The review is right that almost every team should choose decision-record verification, and Class A is therefore mandatory while Class B is opt-in and explicitly discouraged in §16's phasing. Class B stays in the document because "a regulator required recomputation in writing" is a real scenario in this problem domain, and a deployment that discovers the requirement later needs the planner-pinning and hermetic-artifact obligations to have existed from the start (§8.2) — those are exactly the things that cannot be added retroactively to investigations already in flight.

### 17.4 Retained unchanged, as the review recommended

The compiler never queries the control plane. Planning and policy enforcement separated from LLM reasoning. Policy bound by the control plane at reconciliation time and never carried in the goal. Capability schema separated from operational state. Bounded and requested trace levels with a backpressure-aware sink. Fixed-point money with explicit `unknown`, now with the encoding and rounding rules it was missing.

## 18. Architecture Panel Review Disposition (Draft 3)

A six-person panel reviewed Draft 2 subsystem by subsystem. Disposition below; the panel's headline recommendation is addressed in §18.5.

### 18.1 Accepted in full

| Finding | Change | Where |
|---|---|---|
| JSON Pointers in `GoalSpec` drift against payload refactors and are the field an LLM is most likely to hallucinate | `GoalInternalBinding.path` replaced by nominal `outputRole` against a declared, closed role set; deprecated assertion types resolve at admission | §7.1 |
| Most strategies are tables, not programs; the Wasm toolchain is a barrier on the common path | `DeclarativeContribution` added as the default form, evaluated natively; Wasm reserved for `ComputedContribution`; frontier derived rather than declared for the declarative form | §5.12, §9.1, §10.2 |
| The predicate operator set blocks regex, IP-subnet, and geo-distance matching | Extension procedure specified: domain matching enters through `AttributeDefinition` and registered transforms, with the operator set closed for a stated reason | §7.3 |
| `GraphNode` is a flat bag of spec, config, and runtime fields | Split into `spec` / `dataFlow` / `status`, with `NodeStatus` supplying the per-node state the model previously lacked entirely | §7.5 |
| The decision record does not belong inline in a warm-path object | Referenced by content digest; written to append-only storage | §7.5.1 |
| Nested `FAN_OUT` blows up graph payloads | Fan-out is a stored template plus runtime `NodeInstance` records; graph size is independent of data volume | §7.5.1 |
| Per-subject KMS keys will not survive the cost and rate limits | HKDF from a tenant key ring per key-ring epoch; KMS calls drop by orders of magnitude | §12 |
| Fuel exhaustion fails whole investigations as inputs grow | Typed `STRATEGY_FUEL_EXHAUSTED` scoped to the contribution; declarative contributions have no fuel dimension | §9.5 |

### 18.2 Accepted with a corrected mechanism

Four findings name a real defect and prescribe a cure that breaks something the defect did not. In each case the defect is fixed and the cure is not adopted; the reasoning is in the section cited.

**Hot/cold split-brain (Subsystem 6) — real hole, wrong cure.** The panel is right that Draft 2 never defined what happens to an attempt in flight when a new revision publishes, and right that this is the most serious defect in the document. It is fixed by §11.7's attempt lifecycle: `CARRIED` / `ORPHANED` / `QUIESCED`, with orphaned outcomes recorded for cost but **inadmissible as evidence**.

The prescribed cure — a single-threaded actor per investigation — does not close it. Serializing the event queue does not recall a request already at a third-party provider, which is where the duplicate effect lives; §11.3 already serializes revision publication via per-investigation OCC, so the "un-synchronized distributed state machine" characterization is not accurate as to ordering. And a strict actor loop would serialize the hot path behind cold-path compilation, forfeiting the latency property in AC-14 that the two-loop split exists to provide. The panel's own praised fix — excluding `revision` from the idempotency key — is what makes `CARRIED` safe; the missing piece was attempt state, not event ordering.

**Idempotency key fragility (Subsystem 7) — real, and the proposed key is worse.** Digesting the whole resolved request is brittle exactly as described. §11.4 now digests a **declared `idempotencyRelevant` projection**, which is immune to additive non-semantic fields.

Keying instead on `investigation_id + step_id + subject_id` would make the key blind to the request's content, so a re-dispatch with a corrected parameter collides with the prior call and a `KEYED` provider returns the old answer to the new question. That is silently wrong evidence with a fully verifying provenance chain — in this platform, a worse failure than a duplicate charge and far harder to detect.

**HKDF crypto-shredding (Subsystem 8) — adopted, with the salt that makes it erasure.** Cost concern accepted and fixed. But deriving subject keys *deterministically* from a tenant key, as proposed, means anyone holding the key ring can re-derive any "erased" subject's key: nothing unrecoverable is ever destroyed, and the GDPR property the section exists for is silently void while every test still passes. §12 derives with a **per-subject random salt** stored in a shreddable partition — same cost profile, and erasure that holds against an adversary with the master key (AC-28).

**`NONE`-idempotency alert load (Subsystem 7) — accepted in effect.** Fail-closed is retained for irreversible and billed effects, but resolution is declared per capability in advance (`IndeterminateResolution`), so a free read against a keyless provider resolves automatically and only genuine judgment calls escalate. Pager load becomes a property of the capability catalogue rather than an emergent property of production.

### 18.3 Accepted in part, where the finding rests on a misreading

Each of these named a real risk but attributed it to a mechanism the document does not have. The underlying risk is addressed; the wording that produced the misreading is also fixed, since a spec that reads that way to six reviewers reads that way to implementers.

**`PlanningContext` hashing (Subsystem 2).** Draft 2 passed everything by reference; the compiler never canonicalized Wasm bytes or policy blobs. The phrase "over the fully resolved, canonicalized context" invited the opposite reading and is corrected in §7.2: the digest is over the **reference tuple**, artifact digests are computed once at publication, and compilation runs on read-set invalidation rather than on every tick. The related churn concern is real and separately fixed — operational fact versions now advance on **material change to the decision-relevant projection**, so identical health checks do not mint invalidating versions.

**Fact-store growth and audit (Subsystem 2).** Facts are versioned per resource, not per attribute observation. And purging expired facts does not break historical verification: under Class A the decision record carries the read-set and the values the decision turned on, so verification never consults the live fact store. §7.2 now states this, because it is a direct dividend of choosing verification over recomputation and was left implicit.

**`UNKNOWN` as timer management (Subsystem 3).** Two different constructs were described in one vocabulary. Predicate `UNKNOWN` in capability matching resolves *within the compilation* — policy declares admissibility, default inadmissible, capability filtered, no timer. Condition `UNKNOWN` in a graph node is the one that waits, and waiting for a runtime-discovered identifier is the system's premise. §7.3 now states the distinction as a rule.

**Audit truncation and compliance (Subsystem 9).** The tiering existed but its consequence was unstated. §13 now tables it: the compliance tier is a durable precondition and is never dropped; only the diagnostic tier is droppable, with an explicit marker. The sidecar-to-columnar-storage suggestion is a sound topology and is noted as compatible but non-normative.

**Namespace fragmentation (Subsystem 1).** Real, and partially addressed by admission-time resolution of deprecated types to their replacements (§7.1) on top of the existing ownership and deprecation ladder. Registry discovery and federation remain deferred to Phase 2 — the panel did not propose a mechanism, and neither does this draft.

### 18.4 Defended

**Assertion types are not internal plugin namespaces (Subsystem 1, coupling).** `com.example.vendor/registration@v1` is an `AssertionTypeDefinition` — a published registry artifact with an owner, a schema, and a deprecation ladder. Strategies *select on* assertion types; they do not own them. A caller depending on a published, versioned vocabulary is depending on an interface, which is the correct direction. The alternative in the panel's redesign — deriving data dependencies automatically from strategy input/output schema contracts — is ambiguous in exactly the case this system is built for: when a composite goal contains two assertions producing the same evidence type, type-directed wiring cannot know which one feeds the downstream step, and the caller must disambiguate anyway. §7.1 keeps the explicit reference and removes the fragility (structural pointers) rather than removing the expressiveness.

**CEL remains deferred (Subsystem 3).** The critique of Draft 1 that produced §7.6 and the transform registry is accepted and already reflected. What is declined is the substitution itself, for three reasons. First, CEL has no three-valued logic, and the proposed remedy — "explicit default handling for missing fields" — is precisely the coercion §7.3 forbids: collapsing `UNKNOWN` to a boolean means a capability that never reported its data-classification compliance is treated as though it had, in either direction, silently. In a platform that gates evidence acquisition on policy, that is a compliance defect wearing the costume of a simplification. Second, adopting CEL does not eliminate the conformance obligation in AC-4, it relocates it onto a third-party implementation whose cross-language agreement on integer overflow, timestamp ranges, and string ordering is not something this project would control. Third, the composition argument is answered in §17.3 with a **measured adoption trigger** rather than a preference, and §13 now requires the two quantities in that trigger to be instrumented — so the decision is scheduled against evidence, not left to whoever argues hardest in year two.

**Class B determinism stays opt-in rather than deleted.** Unchanged from §17.3, and the panel did not contest it.

### 18.5 On the headline finding: "severely over-engineered"

Taken seriously rather than deflected, because it is the finding most likely to be right.

Where it lands: the imperative-Wasm-only contribution model was a genuine, self-inflicted complexity tax on the common path, and §9.1 removes it. That single change takes the majority of contributors from *toolchain, sandbox, fuel budget, hand-declared frontier, golden files* down to *a rule table and a golden file*, and it makes the fifteen-minute onboarding target in §9.6 achievable rather than decorative. §9.6's contributor cost ladder now states, as a design constraint, that nothing above tier 0 may sit on the path of a contributor who is not introducing new vocabulary.

Where it does not land: "five independent version streams" is not something this design introduced. Assertion types, capability schemas, attribute definitions, the strategy interface, and the planner API have different owners and change at different rates in any system with an external contributor population. `CompatibilitySet` does not create those streams; it makes an already-existing skew *checkable at publication* instead of discoverable in production two years later. Deleting it does not reduce the number of version streams by one.

The same applies to the durable-execution substrate (§11.1 requires one and forbids writing one), and to the solver (§8.1 makes it pluggable precisely so it need not be impressive). The count of concepts in this document is largely a count of concerns the domain actually has — auditable selection, erasable personal data, paid non-idempotent providers, runtime-discovered identifiers. What the review correctly identified is that the *cost of participating* had been allowed to scale with the total count of concerns rather than with what a given contributor touches. That is now a stated invariant with a ladder, a phasing plan that ships tier 0 first, and metrics (§13) that reopen the decision if the mix comes out wrong.

### 18.6 Re-review disposition (Draft 3 → Draft 3.1)

The panel approved Draft 3 for Phase 0 implementation with no blocking findings. Its per-subsystem residual-risk column, however, contains items worth closing now rather than filing, and checking them against the text surfaced **two defects introduced by Draft 3 itself**. Both are fixed here.

**Defects in Draft 3, found on re-read:**

| Defect | Fix |
|---|---|
| §7.2 claimed the decision record carries "the fact values the decision turned on," which §13's contents list did not include. The read-set holds identifiers, not values — so Class A verification of a recorded rejection would have had to query the live fact store, making fact retention an audit-period obligation and falsifying §7.2's independence claim. | §13 adds the `WitnessSet`: the attribute values behind every decisive evaluation, scoped to the decision rather than the fact population. AC-31. |
| `NodeInstance` was introduced in §7.5.1 as a new store, and a fan-out over people puts personal data in it. It was never classified for erasure or retention — an erasure bypass created by a payload optimization, which is the exact failure class §12 exists to prevent. | §7.5.1 puts item values behind `itemValueRef` into the subject's encrypted extent and gives instance records a terminality-keyed TTL. AC-29. |

**Residual risks accepted and closed:**

- *Incorrect `idempotencyRelevant` annotation* (Subsystem 7). Correct, and it is the new failure surface my own Draft 3 fix created. §11.4 defaults the annotation to `true`, because the two error directions are asymmetric: a wrongly-excluded semantic field yields silently wrong evidence with verifying provenance, while a wrongly-included cosmetic field yields a duplicate charge that shows up in cost metrics. Exclusions need a justification code, `true → false` is a breaking change, and lint flags excluded binding targets.
- *Backup salt restoration* (Subsystem 8). Draft 3 named this hazard and supplied no control, which is not good enough for the one mechanism the erasure property rests on. §12 adds an append-only erasure journal in a separate failure domain, makes tombstone filtering a precondition of restore completion, and asserts the no-live-salt-for-tombstoned-subject invariant continuously. AC-33.
- *Deprecated assertion accumulation* (Subsystem 1). §7.1 makes the ladder total over all four statuses — `WITHDRAWN` is rejected rather than silently following a stale pointer — bounds transitive resolution, and reports rewrite counts per template owner so deprecation debt is visible to whoever can pay it down. AC-34.
- *Compliance storage footprint* (Subsystem 9). §13 notes that non-droppable is a durability property, not a storage-tier one; content-addressed records with self-contained verification cold-archive freely.
- *High-cardinality fan-out storage* (Subsystem 5). Addressed by the `NodeInstance` TTL above.

**Two points in the sign-offs corrected, because they will otherwise be cited as design claims:**

*"Pure prompt injection protection by design"* overstates what §7.1 provides. Nominal `outputRole` references constrain one field to a closed vocabulary, which removes a class of hallucinated-path failures and makes generated goals validatable. It does not make an LLM-authored `GoalSpec` trustworthy: assertion types, subjects, parameters, and constraints remain attacker-influenceable if the upstream semantic layer ingests untrusted text, and a goal that is *well-formed* is not thereby *authorized*. What this design actually provides is a **bounded blast radius** — a malicious goal cannot invoke an unregistered capability, exceed policy budgets, widen its own credential scope (§11.5), or reach a data classification it was not granted, and every selection it caused is in the decision record. Authorization of goal submission is a control-plane responsibility (§14), and no property in this RFC substitutes for it.

*"The engine will automatically trigger adoption of `core/EXPRESSION`"* misreads §17.3. The metric schedules a decision; it does not execute one. An implementation that self-adopts a new node kind on a threshold would be adding an unreviewed expression language to an audited planner at runtime. §17.3 now says so explicitly.

**Status:** Draft 3.1 carries the panel's approval for Phase 0 with these items folded in. Nothing above changes the Phase 0 scope in §16.

## 19. Deferred Work

Learning may later propose policy inputs, but it MUST NOT bypass the planning context, solver, decision record, or audit contracts in this RFC.

A general expression language (`core/EXPRESSION`, CEL subset) is deferred under the explicit trigger in §17.3, now instrumented per §13.

An extension to the declarative contribution form is deferred pending the contribution-form mix metric in §13; if computed contributions exceed 40% of publications, the declarative form is underpowered and the gap is specified rather than absorbed by a return to Wasm-only.

Registry discovery and federation across organizational boundaries are deferred to Phase 2.
