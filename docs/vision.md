# Vision

## The problem

Serious evidence gathering — vendor due diligence, KYB, sanctions and adverse-media screening, insurance underwriting, supply-chain verification — is a planning problem wearing the costume of a retrieval problem.

A real investigation combines four things that pull in different directions:

- **domain requirements** — what evidence this kind of subject demands
- **capability eligibility** — which providers can actually produce it, at what cost, in which jurisdictions, under what data classification
- **policy constraints** — what this tenant is permitted to acquire, spend, and retain
- **runtime discovery** — half the identifiers you need to make the *next* request only exist after an earlier one returns

The current answer is to hand all four to an LLM agent and let it decide, step by step, in prose. That produces a system that works impressively in a demo and cannot answer the only question that matters in a regulated setting: **why did you choose that, and would you choose it again?**

## Why the obvious approaches fail

**Agentic loops** make every decision a function of unstated reasoning. You cannot replay them, you cannot diff two runs, and you cannot tell a regulator why provider B was skipped. When the model updates, your entire decision history becomes unreproducible — silently, with no version to point at.

**Static DAGs** are auditable but cannot express the actual shape of the work. You do not know you need to check the third director until you have the registry filing that names them. Front-loading the graph means either over-fetching everything or failing on the interesting cases.

**Rules engines and workflow tools** handle the sequencing but have nothing to say about *selection* — which of eleven eligible providers, under which policy, at what cost, and on what evidence. That is the decision anyone actually audits, and it is the one nobody writes down.

## What this is

A planner that compiles a declarative goal and an immutable, recorded context into a **declarative execution graph** — not a pre-rendered tape of requests, but a graph with typed bindings, conditions, and unresolved nodes that a controller reconciles as evidence arrives.

Every compilation emits a **decision record**: the candidates considered, the decisive constraint for every rejection, the values those decisions turned on, and the exact inputs read. Replay means verifying that record against those inputs. Not re-running a model. Not re-running a solver.

That single choice — verify rather than recompute — is what makes the rest affordable. The solver becomes a freely upgradable component, because upgrading it does not invalidate a single historical decision. Byte-exact recomputation stays available for the deployment whose regulator demands it in writing, and stays off everyone else's bill.

Three things then follow that are not optional in this domain and are almost never in the box:

- **Exactly-one provider effect.** Keys derived in the graph, a write-ahead intent protocol, and an explicit answer for providers that cannot support keys at all. When you model money to the micro, the executor crashing between the call and the log is the bug that matters.
- **Erasure that does not break the audit.** Evidence encrypted under per-subject keys; erasure destroys the key. The hash chain still verifies, the provenance still verifies, and the bytes are gone.
- **Impossible answered as impossible.** A goal outside what the installed strategies can ever produce fails at compile time, naming the missing evidence type, before a cent is spent.

## What it refuses to be

An LLM may translate a human request into a goal, and may reason over evidence once acquired. **Neither is part of the planning decision.** That boundary is the product.

It does not rank providers inside domain plugins — that is how cost, health, and tenancy policy end up smeared across fifty contributed bundles. It does not implement a workflow engine; it requires a durable substrate and declines to rewrite one. It does not promise the evidence is true, only that the decision to seek it is explicable.

## The wedge

Start where the pain is sharpest and the audit obligation is already written down: **regulated vendor and counterparty diligence**. The buyer already has a compliance team asking why a check was skipped, already pays per API call, already has a GDPR erasure obligation colliding with an immutable log, and already has an agentic prototype that impressed everyone and cannot ship.

Phase 0 is six to eight weeks to a working investigation — declarative rules, predicate matching, a deterministic sort, a durable executor, a decision record. Not the full platform. The full platform before the first provider integration is eighteen months with the requirement algebra unvalidated against the domain the entire time, and that ordering is a mistake the design does not require.

## What success looks like

**In one year.** A compliance officer opens an investigation from eight months ago, sees which provider was selected and the decisive constraint that rejected each alternative, and does not need an engineer to interpret it. A contributor from a domain team ships a new evidence rule in an afternoon without ever learning what Wasm is.

**In three years.** Hundreds of contributed strategies compose without an ordering conflict, because composition is a semilattice and ordering does not exist as a concept. The solver has been replaced twice and no historical decision was invalidated. A subject exercised erasure and every audit digest still verifies. Nobody has had to explain to a regulator that the model was updated.

**The test that matters.** Two independent implementations, given the same recorded inputs, agree on every decision to the micro — and when one of them is wrong, the record says exactly where.
