# agent-planner

A deterministic evidence-planning platform. It compiles a declarative investigation goal plus an immutable planning context into an execution graph, then reconciles and executes that graph as evidence arrives — with every material decision recorded in a verifiable decision record.

**Status: pre-implementation.** The design is settled ([RFC-0001](docs/rfcs/RFC-0001-deterministic-evidence-planner.md), Draft 3.1, approved for Phase 0). No code exists yet.

## Documents

| Doc | What it is |
|---|---|
| [docs/rfcs/RFC-0001](docs/rfcs/RFC-0001-deterministic-evidence-planner.md) | The normative spec. Section numbers cited below refer to it. |
| [docs/architecture.md](docs/architecture.md) | Diagrams: system context, compile pipeline, reconciliation loops, attempt lifecycle, trust boundaries. |
| [docs/vision.md](docs/vision.md) | Why this exists, what it refuses to be, what success looks like. |
| [docs/pitch-deck.md](docs/pitch-deck.md) | Slide-form summary for non-implementers. |

The RFC is long because the domain is. §17, §18, and §18.6 record what was reviewed, accepted, and defended — **read the disposition before proposing a change that the RFC already argues against**, and if you disagree, argue with the recorded reasoning rather than around it.

## Invariants — do not violate these without amending the RFC

These are not style preferences. Each one is load-bearing for a property the platform exists to provide, and each has an acceptance criterion in §15.

1. **The compiler is a pure function of its recorded inputs.** It never reads a clock (`planningInstant` is passed as data), never generates randomness, never queries the control plane, and never retrieves evidence. If you need time or state in the compiler, it comes through `PlanningContext`.
2. **No floating point.** Not in comparison, arithmetic, or serialization. Money is fixed-point integers in canonical decimal *strings* (§7.4). Half-even rounding, applied once, to the final result.
3. **Unknown is never coerced.** Not to `false`, not to a default, not to zero, not dropped from an aggregate. Three-valued Kleene logic is normative with published truth tables (§7.3, §7.6). This is the single most likely thing to get quietly "simplified" — don't.
4. **Every compilation emits a decision record**, written to content-addressed storage and referenced by digest. It is the reproduction artifact; replay means *verifying* the record, not recomputing the search (§8.1). Everything else in the design is retrofittable behind it; nothing is retrofittable without it.
5. **Idempotency keys are derived in the graph, not the executor** (§11.4), exclude `revision`, and digest only `idempotencyRelevant` fields. The annotation defaults to `true`. A duplicate charge is recoverable; wrong evidence with verifying provenance is not.
6. **Personal data lives only in per-subject encrypted extents.** Any new store that can hold subject data — this has already been missed once, see §18.6 — must be classified for erasure and given a retention rule. Never inline a subject value into an append-only log.
7. **The executor makes no decisions.** No alternate providers, no altered request templates, no silent retries. Failure is a state fact for the next reconciliation (§11.5).
8. **Canonical serialization is byte-identical for a given logical object.** Ordering, encoding, and tie-breaks are specified; don't introduce map iteration order or insertion order into anything that gets hashed.

## Design constraints that shape new work

- **Contributor cost ladder (§9.6).** Tier 0 — a declarative rule table — must stay sufficient for anyone not introducing new vocabulary. A change that moves work down a tier is worth making; one that pushes a common case up a tier needs a stated reason in the RFC.
- **Declarative first.** `DeclarativeContribution` (native, no toolchain) is the default; Wasm `ComputedContribution` is the escape hatch for contributions that genuinely compute (§9.1).
- **Two loops.** The hot advance loop does pure graph evaluation in milliseconds and never compiles. The cold replan loop compiles and is triggered *only* by read-set invalidation (§11.2). Don't put a solver call on the hot path.
- **Registry over enum.** Node kinds, attributes, transforms, and assertion types are namespaced registry artifacts with owners, versions, conformance vectors, and a deprecation ladder. Adding a closed enum that contributors need to extend is the anti-pattern.
- **Predicate operators are closed** (§7.3). Domain matching — regex, IP, geo — enters through `AttributeDefinition` and registered transforms, never by growing the operator set. Regex in particular cannot satisfy the cross-language conformance requirement.

## Phase 0 scope (§16)

`GoalSpec → declarative contributions → predicate capability match → deterministic tuple sort with digest tie-break → durable execution → decision record.`

No ILP, no Class B determinism, no Wasm, no computed contributions, single loop. Build these at full rigor anyway, because they are the expensive retrofits: the attribute registry and predicate language; idempotency keys with the declared projection; crypto-shredded evidence storage with per-subject salts; attempt disposition; and the decision record.

**Build on a durable execution substrate — do not write one** (§4, §11.1). The novel contribution here is the compiler.

## Working conventions

- Decisions that change the design go in the RFC with the reasoning, not in code comments. The RFC's value is that its arguments are recorded.
- Amendments append a disposition section; don't silently rewrite settled sections.
- Three metrics gate deferred decisions (§13): attempt disposition rate, contribution-form mix, and transform chain depth. If you build the thing, build its metric.
- The RFC is not a git repository yet. `git init` before the first code lands.
