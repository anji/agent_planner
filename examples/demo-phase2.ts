import {
  canonicalDigest,
  Compiler,
  CryptographicAuditSink,
  FederatedRegistry,
  ILPSolver,
  SchemaRegistry,
  TenantShareEnforcer,
  verifyDecisionRecord,
  CapabilityDeclaration,
  CompileRequest,
  GoalSpec,
  PlanningContext,
} from '../src/index.js';

async function main() {
  console.log('====================================================');
  console.log('  Agent Planner — Phase 2 End-to-End Demo');
  console.log('====================================================\n');

  // 1. Multi-Objective Exact ILP Solver
  console.log('🎯 Step 1: Running Multi-Objective Exact ILP Solver...');
  const solver = new ILPSolver();

  const candidatesMap = new Map<string, CapabilityDeclaration[]>();
  candidatesMap.set('assert-user-loc', [
    {
      capabilityUid: 'cap-expensive-provider',
      targetAssertionTypes: ['com.acme/location@v1'],
      attributes: {},
      credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-expensive-provider'] },
      costMicros: '250000', // $0.25
      currency: 'USD',
    },
    {
      capabilityUid: 'cap-optimal-provider',
      targetAssertionTypes: ['com.acme/location@v1'],
      attributes: {},
      credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-optimal-provider'] },
      costMicros: '50000', // $0.05
      currency: 'USD',
    },
  ]);

  const solverRes = solver.solveOptimalSelection(candidatesMap);
  console.log(`✅ Optimal Candidate Selected: ${solverRes.selectedCapabilities[0]?.capabilityUid}`);
  console.log(`   Total Cost: $${(Number(solverRes.totalCost.amountMicros) / 1000000).toFixed(2)} (${solverRes.totalCost.currency})`);
  console.log(`   Solver Algorithm: ${solverRes.solverAlgorithm}`);

  // 2. Decision Record Verification (§8.1)
  console.log('\n🔄 Step 2: Running Offline Decision Record Verification (§8.1)...');
  const registry = new SchemaRegistry();
  registry.registerAssertionType({
    name: 'com.acme/location@v1',
    owner: 'secops',
    subjectSchema: { digest: 'd' },
    outputRoles: {},
  });

  const compiler = new Compiler(registry);

  const goalSpec: GoalSpec = {
    apiVersion: 'evidence.engine/v1alpha1',
    kind: 'InvestigationGoal',
    metadata: { tenant: 'acme-corp', createdAt: 1000000 },
    assertions: [
      {
        uid: 'assert-user-loc',
        type: 'com.acme/location@v1',
        subject: { type: 'core/string', value: 'user-999' },
        required: true,
      },
    ],
    constraints: {},
  };

  const capSnap = {
    capabilities: [solverRes.selectedCapabilities[0]!],
    productionFrontier: ['com.acme/location@v1'],
  };

  const polSnap = { unknownAdmissible: false, policyRulesAllowed: [] };

  const context: PlanningContext = {
    capabilitySnapshot: { digest: 'sha256:cap', schemaVersion: 'v1' },
    policySnapshot: { digest: 'sha256:pol', schemaVersion: 'v1' },
    strategyBundle: { digest: 'sha256:bundle', version: '1.0.0' },
    operationalFacts: [
      {
        capabilityUid: 'cap-optimal-provider',
        version: 'v1',
        observedAt: 1000000,
        validUntil: 10000000,
      },
    ],
    stateFacts: [],
    planningInstant: 2000000,
    integrityDigest: 'sha256:integrity-digest',
  };

  const request: CompileRequest = {
    goal: { digest: 'g' },
    context: { digest: 'c' },
    traceLevel: 'NONE',
  };

  const initialGraph = compiler.compile(request, goalSpec, context, capSnap, polSnap);

  const baseRecord = {
    apiVersion: 'evidence.engine/v1alpha1' as const,
    kind: 'DecisionRecord' as const,
    decisionDigest: '',
    goalDigest: request.goal.digest,
    contextIntegrityDigest: context.integrityDigest,
    selectedCapabilities: [
      {
        capabilityUid: 'cap-optimal-provider',
        targetAssertionUid: 'assert-user-loc',
        decisiveAttributes: {},
      },
    ],
    candidateEvaluations: [
      {
        capabilityUid: 'cap-optimal-provider',
        targetAssertionUid: 'assert-user-loc',
        outcome: 'SELECTED' as const,
        credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-optimal-provider'] },
        costMicros: '50000',
        currency: 'USD',
      },
    ],
    appliedRelaxations: [],
    provenance: initialGraph.provenance,
    readSet: [],
    witnessedValues: [],
  };

  const decisionDigest = canonicalDigest(baseRecord);
  const historicalRecord = { ...baseRecord, decisionDigest };

  const verificationResult = verifyDecisionRecord(historicalRecord, registry);

  console.log(`✅ Offline Decision Record Verification Result:`);
  console.log(`   Valid Digest: ${verificationResult.valid}`);
  console.log(`   Recorded Digest: ${verificationResult.recordedDigest}`);

  // 3. Multi-Tenant Share & Concurrency Enforcement
  console.log('\n🔒 Step 3: Enforcing Multi-Tenant Concurrency Slots...');
  const tenantEnforcer = new TenantShareEnforcer();
  tenantEnforcer.setTenantPolicy({
    tenant: 'tenant-finance',
    concurrencySlots: 2,
    sharePercentage: 40,
  });

  const slot1 = tenantEnforcer.acquireSlot('tenant-finance');
  const slot2 = tenantEnforcer.acquireSlot('tenant-finance');
  const slot3 = tenantEnforcer.acquireSlot('tenant-finance');

  console.log(`   Acquire Slot 1: Granted=${slot1.granted}`);
  console.log(`   Acquire Slot 2: Granted=${slot2.granted}`);
  console.log(`   Acquire Slot 3: Granted=${slot3.granted} (Reason: "${slot3.reason}")`);

  // 4. Cryptographic Audit Sink with Hash Chaining
  console.log('\n📜 Step 4: Appending to Cryptographic Audit Hash Chain...');
  const auditSink = new CryptographicAuditSink();
  const block1 = auditSink.appendRecord(historicalRecord, 1_700_000_000_000_000);
  const block2 = auditSink.appendTruncatedMarker('Diagnostic log elided per AC-30 audit quota', 1_700_000_000_000_001);

  console.log(`   Block 1 Digest: ${block1.blockDigest}`);
  console.log(`   Block 2 Digest: ${block2.blockDigest}`);

  const auditVerification = auditSink.verifyChainIntegrity();
  console.log(`✅ Audit Chain Verification: Valid=${auditVerification.valid}, Blocks=${auditVerification.blockCount}`);

  // 5. Federated Registry Lookup
  console.log('\n🌐 Step 5: Performing Federated Schema Registry Lookup...');
  const federatedReg = new FederatedRegistry();
  federatedReg.registerChildRegistry('acme-secops-registry', registry);

  const foundType = federatedReg.findAssertionType('com.acme/location@v1');
  console.log(`✅ Federated Lookup Success!`);
  console.log(`   Source Registry: ${foundType?.sourceRegistryId}`);
  console.log(`   Owner:           ${foundType?.definition.owner}`);

  console.log('\n====================================================');
  console.log('  Phase 2 Demo Complete — Full System Deployed!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
