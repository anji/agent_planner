# agent-planner

Deterministic evidence planning. Compiles a declarative investigation goal and an immutable planning context into an execution graph, reconciles it as evidence arrives, and records every material decision in a form that verifies years later.

An LLM may translate a human request into a goal, and may reason over evidence once acquired. Neither is part of the planning decision. That boundary is the point.

**Status:** pre-implementation. Design settled and reviewed — [RFC-0001 Draft 3.1](docs/rfcs/RFC-0001-deterministic-evidence-planner.md), approved for Phase 0.

## Start here

| | |
|---|---|
| [Vision](docs/vision.md) | Why this exists, what it refuses to be, what success looks like. |
| [Pitch deck](docs/pitch-deck.md) | Fifteen slides for non-implementers. |
| [Architecture](docs/architecture.md) | Diagrams: compile pipeline, reconciliation loops, attempt lifecycle, erasure boundary. |
| [RFC-0001](docs/rfcs/RFC-0001-deterministic-evidence-planner.md) | The normative spec, with both review dispositions. |
| [CLAUDE.md](CLAUDE.md) | Invariants and conventions for anyone — human or agent — writing code here. |

## In one paragraph

Evidence acquisition combines domain requirements, provider eligibility, policy constraints, and identifiers that only exist after earlier requests return. Handing all four to an agentic loop produces a system that demos well and cannot answer why it chose what it chose. Handing them to a static DAG produces one that can't express the work. This compiles the decision instead: a pure function of recorded inputs, emitting a decision record that is verified rather than recomputed — which keeps the solver upgradable, the audit intact across model and library changes, and the erasure obligation compatible with the immutable log.

## Layout

```
docs/
  rfcs/     RFC-0001 — normative spec
  vision.md
  architecture.md
  pitch-deck.md
CLAUDE.md   invariants for implementers
```
