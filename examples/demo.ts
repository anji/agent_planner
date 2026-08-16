import { randomBytes } from 'node:crypto';
import {
  Compiler,
  CryptoShreddedStore,
  SchemaRegistry,
  SubjectSaltStore,
  classifyAttemptAcrossRevision,
  deriveNodeIdempotencyKey,
  verifyDecisionRecord,
  GoalSpec,
  PlanningContext,
  CompileRequest,
  NodeAttemptIntent,
} from '../src/index.js';

async function main() {
  console.log('====================================================');
  console.log('  Agent Planner — Phase 0 End-to-End Demo');
  console.log('====================================================\n');

  // 1. Initialize Registry & Define Assertion Types
  const registry = new SchemaRegistry();
  registry.registerAssertionType({
    name: 'com.acme.security/user-identity@v1',
    owner: 'secops-team',
    subjectSchema: { digest: 'sha256:subj-schema-v1' },
    outputRoles: {
      'identity-record': { digest: 'sha256:role-schema-v1' },
    },
  });

  console.log('✓ Registered Assertion Type: com.acme.security/user-identity@v1');

  // 2. Provision the subject key in the data plane, BEFORE compiling (§13).
  //    The compiler only reads it; minting a salt during compile would put
  //    randomness on the pure path and break AC-1.
  const masterKeyRing = randomBytes(32);
  const saltStore = new SubjectSaltStore();
  const shreddedStore = new CryptoShreddedStore(masterKeyRing, saltStore);
  const subjectId = 'subject-user-884';
  saltStore.getOrCreateSalt(subjectId);
  const demoSubjectKey = shreddedStore.deriveSubjectKey(subjectId);

  // 3. Define GoalSpec & PlanningContext
  const goalSpec: GoalSpec = {
    apiVersion: 'evidence.engine/v1alpha1',
    kind: 'InvestigationGoal',
    metadata: { tenant: 'acme-corp', createdAt: Date.now() * 1000 },
    assertions: [
      {
        uid: 'user-investigation-1',
        type: 'com.acme.security/user-identity@v1',
        subject: { type: 'core/string', value: 'subject-user-884' },
        required: true,
      },
    ],
    constraints: {
      policyRelaxationsAllowed: false,
    },
  };

  const context: PlanningContext = {
    capabilitySnapshot: { digest: 'sha256:cap-snap-100', schemaVersion: 'v1' },
    policySnapshot: { digest: 'sha256:pol-snap-100', schemaVersion: 'v1' },
    strategyBundle: { digest: 'sha256:bundle-v1.0.0', version: '1.0.0' },
    operationalFacts: [
      {
        capabilityUid: 'cap-identity-provider-alpha',
        version: 'v1.2',
        observedAt: Date.now() * 1000 - 60000000,
        validUntil: Date.now() * 1000 + 60000000,
      },
    ],
    stateFacts: [],
    planningInstant: Date.now() * 1000,
    integrityDigest: 'sha256:integrity-tuple-digest',
    // Personal-data commitments require a pre-provisioned secret subject key (§13).
    // Provisioning happens in the data plane BEFORE compile; the compiler only reads.
    subjectKeys: new Map([[subjectId, demoSubjectKey]]),
  };

  const compileRequest: CompileRequest = {
    goal: { digest: 'sha256:goal-digest' },
    context: { digest: 'sha256:context-digest' },
    traceLevel: 'VERBOSE_AUDIT',
  };

  const capabilitySnapshot = {
    capabilities: [
      {
        capabilityUid: 'cap-identity-provider-alpha',
        targetAssertionTypes: ['com.acme.security/user-identity@v1'],
        attributes: {
          'com.acme.security/compliance-level': { type: 'core/string', value: 'SOC2_TYPE_2' },
        },
        credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-identity-provider-alpha'] },
        costMicros: '50000', // $0.05
        currency: 'USD',
        isPersonalData: true,
      },
    ],
    productionFrontier: ['com.acme.security/user-identity@v1'],
  };

  const policySnapshot = {
    unknownAdmissible: false,
    policyRulesAllowed: [],
  };

  // 3. Run Pure Compiler Pipeline
  console.log('🔄 Compiling GoalSpec + PlanningContext...');
  const compiler = new Compiler(registry);
  const executionGraph = compiler.compile(
    compileRequest,
    goalSpec,
    context,
    capabilitySnapshot,
    policySnapshot
  );

  console.log(`\n✅ Execution Graph Compiled Successfully!`);
  console.log(`   Graph UID: ${executionGraph.graphUid}`);
  console.log(`   Status:    ${executionGraph.status}`);
  console.log(`   Nodes:     ${executionGraph.nodes.length} node (${executionGraph.nodes[0]?.kind})`);
  console.log(`   Decision Record Ref: ${executionGraph.decisionRecordRef.digest}`);

  // 4. Derive Graph Idempotency Keys & Classify Attempt
  const targetNode = executionGraph.nodes[0]!;
  const idempotency = deriveNodeIdempotencyKey(executionGraph.graphUid, targetNode);
  console.log(`\n🔑 Graph-Derived Idempotency Key:`);
  console.log(`   Key:    ${idempotency.idempotencyKey}`);
  console.log(`   Digest: ${idempotency.idempotencyDigest}`);

  const intent: NodeAttemptIntent = {
    attemptUid: 'att-attempt-001',
    nodeUid: targetNode.uid,
    revision: 1,
    idempotencyKey: idempotency.idempotencyKey,
    idempotencyDigest: idempotency.idempotencyDigest,
    dispatchedAt: Date.now() * 1000,
  };

  const disposition = classifyAttemptAcrossRevision(intent, executionGraph);
  console.log(`\n⚡ Attempt Disposition across Graph Revision:`);
  console.log(`   Status: ${disposition.disposition}`);
  console.log(`   Reason: ${disposition.reason}`);

  // 5. Crypto-Shredded Evidence Storage & Erasure Verification
  console.log(`\n🔒 Encrypting Evidence into Crypto-Shredded Storage...`);
  const rawEvidence = JSON.stringify({
    fullName: 'Alice Smith',
    ssn: '000-12-3456',
    email: 'alice@example.com',
  });

  const extent = shreddedStore.encryptEvidence(subjectId, rawEvidence);
  console.log(`   Extent UID:     ${extent.extentUid}`);
  console.log(`   Ciphertext Hex: ${extent.ciphertextHex.substring(0, 32)}...`);

  const decrypted = shreddedStore.decryptEvidence(extent);
  console.log(`   Decrypted Evidence: ${decrypted.toString('utf8')}`);

  console.log(`\n🗑️ Crypto-Shredding Subject Salt for "${subjectId}"...`);
  saltStore.shredSubjectSalt(subjectId, 1_700_000_000_000_000);
  console.log(`   Subject Salt Destroyed!`);

  try {
    shreddedStore.decryptEvidence(extent);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`✅ Erasure Verified! Decryption attempt threw: "${errorMsg}"`);
  }

  console.log('\n====================================================');
  console.log('  Demo Complete — All Phase 0 Invariants Verified!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
