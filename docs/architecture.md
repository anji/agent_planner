# Architecture

Diagrams for [RFC-0001](rfcs/RFC-0001-deterministic-evidence-planner.md). The RFC is normative; where this document and the RFC disagree, the RFC wins.

---

## 1. System context

The load-bearing structural decision: **the compiler never queries the control plane.** It is a pure function of a recorded context, which is what makes every decision it produces auditable.

```mermaid
flowchart TB
    subgraph upstream["Upstream — outside this protocol"]
        LLM["Semantic layer<br/>natural language to GoalSpec"]
        API["Direct API callers"]
    end

    subgraph plane["Control plane — owns mutable state"]
        GOAL["Goal API<br/>admission, deprecation resolution"]
        CTX["Context Resolver<br/>referential integrity, integrityDigest"]
        REG["Registry<br/>attributes, transforms, assertion types,<br/>capabilities, compatibility sets"]
        POL["Policy / health / quota<br/>per-resource versioned"]
    end

    subgraph core["Planning core — pure"]
        REC["Reconciler"]
        COMP["Compiler + pluggable solver"]
        BUNDLE["Strategy bundles<br/>declarative rules + Wasm"]
    end

    subgraph exec["Execution"]
        ADV["Advance loop — hot"]
        REP["Replan loop — cold"]
        EXE["Executor"]
        ADAPT["Provider adapters"]
    end

    subgraph data["Data planes"]
        LOG["Durable event log<br/>append-only, tamper-evident"]
        BLOB["Evidence blob store<br/>crypto-shredded"]
        DR["Decision records<br/>content-addressed"]
    end

    LLM --> GOAL
    API --> GOAL
    GOAL --> REC
    REG --> CTX
    POL --> CTX
    CTX -- "PlanningContext by reference" --> REC
    REC --> ADV
    REC --> REP
    REP --> COMP
    COMP <--> BUNDLE
    COMP --> DR
    ADV --> EXE
    EXE --> ADAPT
    ADAPT --> LOG
    EXE --> BLOB
    LOG --> REC

    style core fill:#e8f4ff,stroke:#4a90d9
    style data fill:#f0f0f0,stroke:#888
```

Note the absent arrow: nothing runs from the control plane *into* the compiler at compile time. Everything it needs was resolved into `PlanningContext` first, and recorded.

---

## 2. Compilation pipeline

Ten steps, §8. Step 6 is the one that saves money: static infeasibility is proven against the bundle's production frontier **before any budget is spent**, so an impossible goal fails in milliseconds rather than after thirty minutes and forty dollars.

```mermaid
flowchart TD
    A["CompileRequest<br/>goal ref + context ref"] --> B["1. Referential integrity<br/>fail: CONTEXT_INTEGRITY_VIOLATION"]
    B --> C["2. Canonicalize + validate"]
    C --> D["3. Resolve assertions to contributions"]
    D --> E["4. Expand independently<br/>merge by conjunction"]
    E --> F["5. Apply policy relaxations"]
    F --> G{"6. Inside frontier closure?"}
    G -- no --> H["UNSATISFIABLE<br/>zero spend, missing type named"]
    G -- yes --> I["7. Filter capabilities<br/>3-valued predicate evaluation"]
    I --> J["8. Select by policy objectives<br/>fixed-point money, digest tie-break"]
    J --> K["9. Compile graph<br/>reject cycles + type-invalid data flow"]
    K --> L["10. Emit decision record,<br/>read-set, witness set"]
    L --> M["ExecutionGraph + decisionRecordRef"]

    style G fill:#fff4e0,stroke:#d9924a
    style H fill:#ffe8e8,stroke:#d94a4a
    style L fill:#e8ffe8,stroke:#4ad94a
```

**Merge is a semilattice** (§9.3): union of requirements keyed by content-derived uid, constraint sets unioned. Idempotent, commutative, associative — so contribution order does not exist as a concept, and there is nothing for contributors to compete over. Two contributions that conflict produce a diagnosable unsatisfiable set naming both digests, not a silent last-writer-wins.

---

## 3. Reconciliation: two loops

A sequential chain of ten nodes under a single windowed loop pays the window ten times for zero planning work. Splitting readiness advancement from recompilation is what makes an N-hop chain independent of the reconciliation window (AC-14).

```mermaid
flowchart LR
    EV["State fact arrives"] --> Q{"Touches the<br/>read-set?"}
    Q -- "no — the common case" --> HOT
    Q -- yes --> COLD

    subgraph HOT["Advance loop — hot, milliseconds"]
        H1["Re-evaluate pending<br/>bindings and conditions"] --> H2["Schedule newly-ready nodes"]
        H2 --> H3["Pure graph evaluation<br/>no solver, no strategies, no window"]
    end

    subgraph COLD["Replan loop — cold, windowed"]
        C1["Read-set invalidated:<br/>version advanced, validUntil passed,<br/>policy or rate revision changed"] --> C2["Recompile"]
        C2 --> C3["Publish new revision<br/>per-investigation OCC"]
        C3 --> C4["Classify in-flight attempts"]
    end

    C4 --> HOT
```

Read-set invalidation replaces hand-written relevance rules. A revision is stale **iff** a resource in its read-set advanced or expired — sound by construction, rather than by enumerating four cases correctly. A missed case there meant an investigation stalled forever with no alarm, which is the worst failure mode in the system: an idle investigation looks exactly like a healthy waiting one.

---

## 4. Attempt lifecycle across revision boundaries

The subtlest correctness problem in the design (§11.7). A node is dispatched under revision *N*; while the provider call is outstanding, revision *N+1* publishes. Serializing the event queue does not help — an HTTP request already at a third party is not inside our event loop, and no ordering discipline recalls it.

```mermaid
stateDiagram-v2
    [*] --> Intent: "append NodeAttemptIntent"
    Intent --> InFlight: "invoke provider with key"
    InFlight --> Outcome: "append NodeAttemptOutcome"
    Outcome --> [*]

    InFlight --> Classify: "revision N+1 publishes"
    Classify --> CARRIED: "same node + itemOrdinal<br/>+ idempotencyDigest"
    Classify --> ORPHANED: "node absent, or<br/>projection changed"

    CARRIED --> Outcome: "no re-dispatch;<br/>outcome applies to N+1"
    ORPHANED --> Recorded: "cost-accounted,<br/>INADMISSIBLE as evidence"
    Recorded --> [*]

    note right of CARRIED
        Safe because the idempotency key
        excludes revision by design
    end note

    note right of ORPHANED
        The effect happened and the money
        was spent — an audit log that omits
        it is false. But it cannot satisfy a
        node in the new revision.
    end note
```

Nodes whose capability declares `idempotencySupport: NONE` are **`QUIESCED`** instead: dispatch is withheld while a replan is pending for that node. Without keys there is no way to make a duplicate harmless after the fact, so the only remedy is not to create one. Quiescence is scoped to those nodes, not to the investigation and not to the hot path.

---

## 5. Data planes and the erasure boundary

Immutability and erasure are in direct conflict, and the conflict does not resolve itself. Crypto-shredding buys tamper-evidence **plus** erasure; it does not buy erasure plus recomputation, and no design does.

```mermaid
flowchart TB
    subgraph audit["Survives erasure"]
        A1["Event log hash chain"]
        A2["Decision records:<br/>reason codes, digests,<br/>capability selections, structure"]
        A3["Provenance"]
    end

    subgraph erasable["Destroyed on erasure"]
        E1["Evidence blobs"]
        E2["Personal state facts"]
        E3["Witnessed values<br/>carrying personal data"]
        E4["NodeInstance item values"]
    end

    subgraph keys["Key plane"]
        K1["KMS<br/>per key-ring epoch only"]
        K2["Tenant key ring"]
        K3["Per-subject salt table<br/>256-bit random, shreddable"]
        K4["subjectKey = HKDF<br/>ikm=ring, salt=subjectSalt"]
    end

    K1 --> K2 --> K4
    K3 --> K4
    K4 --> E1 & E2 & E3 & E4

    J["Erasure journal<br/>append-only tombstones<br/>separate failure domain"]
    J -. "filters restores" .-> K3

    style erasable fill:#ffe8e8,stroke:#d94a4a
    style audit fill:#e8ffe8,stroke:#4ad94a
    style J fill:#fff4e0,stroke:#d9924a
```

**The random salt is the whole property.** Deriving subject keys deterministically from the tenant key would cut KMS cost identically and silently void erasure — anyone holding the ring could re-derive any "erased" subject's key, so nothing unrecoverable was ever destroyed. The salt is the unrecoverable secret. It does not show up in any test that omits an adversary with the master key (AC-28).

---

## 6. Registry artifacts and version streams

Five streams evolve independently because they have different owners. `CompatibilitySet` does not create them; it makes existing skew checkable at publication instead of discoverable in production two years later.

```mermaid
flowchart LR
    subgraph streams["Independent version streams"]
        S1["Assertion types"]
        S2["Capability schemas"]
        S3["Attribute definitions"]
        S4["Strategy interface"]
        S5["Planner API"]
    end

    S1 & S2 & S3 & S4 & S5 --> CS["CompatibilitySet<br/>a validated combination"]
    CS --> PUB["Bundle publication<br/>validates against it"]
    CS --> INV["Investigation records<br/>the set it ran under"]

    LADDER["Deprecation ladder<br/>ACTIVE → DEPRECATED → SUNSET → WITHDRAWN<br/>replacement pointer required<br/>ownership transfer for dark namespaces"]
    LADDER -.-> S1 & S2 & S3
```

---

## 7. Contributor cost ladder

The complexity a contributor meets is proportional to what they introduce. This is a design constraint, not documentation (§9.6).

```mermaid
flowchart TD
    T0["Tier 0 — map an assertion to<br/>existing attributes and capabilities<br/><b>rule table + golden file</b>"]
    T1["Tier 1 — a contribution that computes<br/>+ Wasm toolchain, declared frontier, fuel budget"]
    T2["Tier 2 — a new attribute, transform, or node kind<br/>+ registry artifact, owner, conformance vectors"]
    T3["Tier 3 — a new predicate operator<br/>+ planner API version, conformance suite<br/><i>deliberately rare</i>"]

    T0 --> T1 --> T2 --> T3

    style T0 fill:#e8ffe8,stroke:#4ad94a
    style T3 fill:#ffe8e8,stroke:#d94a4a
```

Nothing above tier 0 sits on the path of a contributor who is not introducing new vocabulary. Target: a passing strategy in under fifteen minutes, with no control-plane access.
