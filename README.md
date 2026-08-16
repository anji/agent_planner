# agent-planner

> **Deterministic Evidence Planning Engine**. Compiles a declarative investigation goal and an immutable planning context into an execution graph, reconciles it as evidence arrives, and records every material decision in a verifiable decision record.

An LLM may translate a human request into a goal, and may reason over evidence once acquired. **Neither is part of the planning decision.** That boundary is the product.

**Status:** Phase 0 complete (Pure Deterministic Evidence Compiler, Dual Reconciliation Loops, Offline Verifier, Write-Ahead Intent Protocol, Scoped Credential Broker, and Crypto-Shredded Erasure Store fully implemented according to [RFC-0001](docs/rfcs/RFC-0001-deterministic-evidence-planner.md)).

---

## ⚡ Quick Start & Setup

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **Package Manager**: `npm` (v10+)

### Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/anji/agent-planner.git
cd agent-planner
npm install
```

### Run Tests & Build
Run the automated test suite (56 unit tests across 16 test suites) and build TypeScript ESM targets:

```bash
# Run unit tests with Vitest
npm test

# Build TypeScript ESM target
npm run build

# Typecheck src + tests + examples (build only covers src/)
npm run typecheck
```

---

## 🚀 Interactive Demos

Run any of the built-in end-to-end demo scripts:

### 1. Real-World KYB & Sanctions Diligence Demo
Simulates an LLM agent translating a natural language request (*"Run KYB check on Acme Corp under $2.00"*) into a formal `GoalSpec`, running the deterministic evidence compiler (< 1.3 ms), optimizing provider spend ($0.40 vs $1.00), verifying decision digests offline, and executing GDPR crypto-shredding:

```bash
npx tsx examples/real-world-kyb-demo.ts
```

### 2. Dual Reconciliation Loops & Wasm Substrate (Phase 0 Evaluation Stub)
Demonstrates the hot `AdvanceLoop` (millisecond pure graph evaluation), read-set invalidation (`validUntil` breaches), cold `ReplanLoop` (re-compiling revision *N+1*), attempt disposition classification (`CARRIED`, `ORPHANED`, `QUIESCED`), and static feasibility proofs against strategy production frontiers:

```bash
npx tsx examples/demo-phase1.ts
```

### 3. Exact ILP Solver & Decision Record Verification
Demonstrates multi-objective cost optimization with SHA-256 digest tie-breaking, exact solver selection over historical contexts, multi-tenant concurrency slot enforcement, cryptographic audit log hash chaining, and federated schema registries:

```bash
npx tsx examples/demo-phase2.ts
```

---

## 💻 Code Usage Example

```typescript
import {
  Compiler,
  SchemaRegistry,
  CryptoShreddedStore,
  SubjectSaltStore,
  ExecutorEngine,
  CredentialBroker,
  deriveNodeIdempotencyKey,
  verifyDecisionRecord,
  GoalSpec,
  PlanningContext,
  CompileRequest,
} from 'agent-planner';

// 0. Inputs supplied by the caller / control plane. Time is data, keys are explicit.
const nowMicros = Date.now() * 1000;              // read ONCE, at the edge
const brokerSecretKey = randomBytes(32);          // no default permitted
const tenantMasterKeyRing = randomBytes(32);

// 1. Initialize Schema Registry & Credential Broker
const registry = new SchemaRegistry();
const broker = new CredentialBroker(brokerSecretKey); // >= 32 bytes; no default permitted

registry.registerAssertionType({
  name: 'com.compliance.kyb/corporate-registration@v1',
  owner: 'secops-team',
  subjectSchema: { digest: 'sha256:kyb-schema' },
  outputRoles: { 'corporate-filing': { digest: 'sha256:filing-role' } },
});

// 2. Define GoalSpec & Pre-provision Secret Subject Key
const targetSubjectId = 'corp-tax-99482';
const saltStore = new SubjectSaltStore();
const shreddedStore = new CryptoShreddedStore(tenantMasterKeyRing, saltStore);

saltStore.getOrCreateSalt(targetSubjectId);
const subjectKey = shreddedStore.deriveSubjectKey(targetSubjectId);

const goalSpec: GoalSpec = {
  apiVersion: 'evidence.engine/v1alpha1',
  kind: 'InvestigationGoal',
  metadata: { tenant: 'acme-corp', createdAt: Date.now() * 1000 },
  assertions: [
    {
      uid: 'kyb-check-1',
      type: 'com.compliance.kyb/corporate-registration@v1',
      subject: { type: 'core/string', value: targetSubjectId },
      required: true,
    },
  ],
  constraints: { maxSpend: { amountMicros: '2000000', currency: 'USD' } },
};

const context: PlanningContext = {
  ...baseContext,
  subjectKeys: new Map([[targetSubjectId, subjectKey]]),
};

// 3. Compile ExecutionGraph & Emits DecisionRecord
const compiler = new Compiler(registry);
const executionGraph = compiler.compile(
  compileRequest,
  goalSpec,
  context,
  capabilitySnapshot,
  policySnapshot
);

// 4. Issue Scoped Credential Token (§11.5)
const token = broker.issueScopedCredential(executionGraph.nodes[0]!, policySnapshot.digest, nowMicros);

// 5. Execute Write-Ahead Intent Protocol (§11.4, AC-12)
const executorWithBroker = new ExecutorEngine(invoker, broker);
const outcome = await executorWithBroker.executeNodeAttempt(
  executionGraph, executionGraph.nodes[0]!, undefined, 1, 'KEYED', nowMicros, policySnapshot.digest
);

// 6. GDPR Erasure — Destroy per-subject salt
saltStore.shredSubjectSalt(targetSubjectId, nowMicros);
// Personal payload destroyed; historical DecisionRecord SHA-256 digest remains 100% verified!
```

---

## 🔒 Key System Invariants

1. **Pure Compiler**: Zero clock reading (`planningInstant` is input data), zero randomness, zero control-plane queries.
2. **Zero Floating-Point Math**: Fixed-point micro-integer decimal strings (`amountMicros`). Half-even rounding (Banker's Rounding) applied once to final result.
3. **3-Valued Kleene Logic**: Predicates over absent or missing attributes evaluate to `UNKNOWN` (never coerced to `FALSE` or `TRUE`).
4. **Content-Addressed Decision Records**: Verification re-evaluates candidate predicates and costs offline without querying live databases or solvers.
5. **Graph-Derived Idempotency**: Idempotency keys incorporate `investigationUid`, `nodeUid`, `itemOrdinal`, and `attemptOrdinal`, explicitly excluding graph `revision`.
6. **Crypto-Shredded Storage & Secret-Keyed Commitments**: Personal evidence stored only in per-subject encrypted extents (`subjectKey = HKDF(tenantKeyRing, subjectSalt)`). Personal witness commitments use secret HMAC-SHA256 subject keys and fail-closed with `SUBJECT_KEY_UNAVAILABLE` if unprovisioned.

---

## 📖 Component Architecture & Phase 0 Boundaries

| Component | Status | Description |
|---|---|---|
| **Deterministic Evidence Compiler** | **Phase 0 Complete** | 10-step pure compiler pipeline, ILP cost solver, JCS canonical sorting, deprecation resolution. |
| **Offline Decision Verifier** | **Phase 0 Complete** | Offline tamper check, Kleene 3-valued truth re-evaluation, offline cost rejection verification. |
| **Write-Ahead Intent Executor** | **Phase 0 Complete** | Intent → Invoke → Outcome write-ahead logging protocol, KEYED/NATURAL/NONE idempotency keys, `IndeterminateResolution`. |
| **Scoped Credential Broker** | **Phase 0 Complete** | Cryptographic CredentialToken issuance, policy digest validation (§11.5), scope capability enforcement. |
| **Crypto-Shredded Store** | **Phase 0 Complete** | AES-256-GCM subject extent storage, ErasureJournal tombstones, secret HMAC-SHA256 personal commitments. |
| **Wasm Strategy Runner** | *Phase 0 Stub* | Evaluation stub for WASM strategy module loading and fuel consumption metering. |
| **Golden Harness** | *Phase 0 Stub* | Test harness stub for end-to-end scenario execution traces. |

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE) for details.
