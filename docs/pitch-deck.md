---
marp: true
title: agent-planner
description: Deterministic evidence planning — auditable by construction
paginate: true
---

# agent-planner

### Deterministic evidence planning

Compile the investigation. Record the decision. Verify it years later.

---

## The setup

Regulated diligence — KYB, vendor risk, underwriting, sanctions screening — runs on evidence gathered from dozens of paid providers.

Deciding **what to gather, from whom, under which policy** is the expensive part.

Today that decision is made either by an LLM agent reasoning in prose, or by a hand-maintained DAG that cannot express the work.

---

## The question nobody can answer

> "Why did you use provider B and skip provider A on this file, in March?"

**Agentic loop:** the reasoning wasn't recorded, and the model has been updated twice since.

**Static DAG:** the choice was hardcoded by someone who left.

This question is not academic. It is the audit.

---

## Why it's genuinely hard

Four things pull against each other in every real investigation:

| | |
|---|---|
| **Domain requirements** | what this subject demands |
| **Capability eligibility** | who can produce it, where, at what cost |
| **Policy** | what this tenant may acquire, spend, retain |
| **Runtime discovery** | you don't know the third director until the filing names them |

The last one kills static planning. The first three kill the agent.

---

## The idea

**Separate the decision from the reasoning.**

An LLM may turn a human request into a formal goal. An LLM may interpret evidence once acquired.

Neither is part of the planning decision.

The planner is a pure function of recorded inputs, and it writes down why.

---

## What gets built

```
GoalSpec  ──►  Compiler  ──►  Execution graph  ──►  Reconciler  ──►  Providers
                  │                                      ▲
                  ▼                                      │
           Decision record                          Evidence
```

Not a pre-rendered tape of requests — a **declarative graph** with typed bindings and conditions, reconciled as evidence arrives.

Every compilation emits a decision record.

---

## The insight that makes it affordable

Most designs in this space commit to **byte-exact recomputation** — pin the binary, freeze the solver, reproduce the run.

That is a research project. Solvers drift across versions, presolve, and parallel accumulation order.

**Verify the recorded decision instead of recomputing it.**

The record names the candidates, the decisive constraint for each rejection, and the values behind them. Verification needs no solver at all.

---

## What that buys

**The solver becomes upgradable.** Swap it, improve it, replace it twice — no historical decision is invalidated, because none of them are re-derived.

**Audit survives everything.** Model updates, library bumps, staff turnover, the vendor going out of business.

Byte-exact replay stays available for the deployment whose regulator demands it in writing. It stays off everyone else's bill.

---

## Three things that are never in the box

**Exactly-one provider effect** — keys derived in the graph, write-ahead intent, and an honest answer for providers that can't support keys. When you model money to the micro, a crash between the call and the log is the bug that matters.

**Erasure that doesn't break the audit** — evidence encrypted per subject; erasure destroys the key. Hash chain still verifies, bytes are gone.

**Impossible answered as impossible** — a goal outside what your strategies can ever produce fails at compile time, naming the missing type, before a cent is spent.

---

## The contributor problem

A platform like this dies of its own ceremony. If adding one evidence rule means a Wasm toolchain, a fuel budget, and a hand-declared frontier, nobody adds rules.

**Tier 0 is a rule table and a golden file.** Fifteen minutes, no control-plane access, no toolchain.

Wasm, frontiers, and registry artifacts exist — for the contributors who are actually introducing new vocabulary. Nobody else meets them.

---

## The thing that scales to hundreds of contributors

Contributions merge by **conjunction**. Idempotent, commutative, associative.

Contribution order does not exist as a concept — so there is nothing for contributors to compete over, and no priority number for anyone to inflate.

Two contributions that conflict produce a **diagnosable unsatisfiable set naming both**, not a silent last-writer-wins.

---

## Where it starts

**Regulated vendor and counterparty diligence.**

The buyer already has:

- a compliance team asking why a check was skipped
- a per-call provider bill nobody can attribute
- a GDPR erasure obligation colliding with an immutable log
- an agentic prototype that demoed beautifully and cannot ship

---

## Plan

**Phase 0 — 6–8 weeks.** Declarative rules, predicate matching, deterministic sort, durable executor, decision record. A working investigation.

Built at full rigor even in Phase 0, because they are the expensive retrofits: the attribute registry, idempotency keys, crypto-shredded storage, attempt disposition.

**Phase 1** — contributor readiness. **Phase 2** — scale, and exact recomputation only if someone's regulator demands it.

The full platform before the first provider integration is 18 months with the design unvalidated the whole time.

---

## Status

Design settled and reviewed: **RFC-0001, Draft 3.1** — approved for Phase 0.

Two review rounds recorded in the document, including what was accepted, what was defended, and why. 34 acceptance criteria.

Pre-implementation. No code yet.

---

## The test that matters

Two independent implementations, given the same recorded inputs, agree on every decision **to the micro**.

And when one of them is wrong, the record says exactly where.
