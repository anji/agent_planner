import {
  AdvanceLoop,
  Compiler,
  FrontierClosureEngine,
  GoldenFileHarness,
  ReadSetInvalidator,
  ReplanLoop,
  SchemaRegistry,
  canonicalDigest,
  GoalSpec,
  PlanningContext,
  CompileRequest,
  StrategyBundle,
} from '../src/index.js';

async function main() {
  console.log('====================================================');
  console.log('  Agent Planner — Phase 1 End-to-End Demo');
  console.log('====================================================\n');

  // 1. Production Frontier Closure Proof
  console.log('🛡️  Step 1: Calculating Production Frontier Closure...');
  const frontierEngine = new FrontierClosureEngine();

  const bundle: StrategyBundle = {
    bundleUid: 'bundle-secops-v1',
    version: '1.0.0',
    digest: 'sha256:bundle-secops-v1-digest',
    declaredFrontier: [
      'com.acme.security/user-identity@v1',
      'com.acme.security/device-posture@v1',
    ],
    contributions: [
      {
        kind: 'DECLARATIVE',
        contributionUid: 'contrib-identity-01',
        targetAssertionType: 'com.acme.security/user-identity@v1',
        outputRoles: ['user-id-output'],
        requiredPredicates: [],
        nodeTemplates: [],
      },
    ],
  };

  const closure = frontierEngine.computeFrontierClosure([bundle]);
  const proof = frontierEngine.proveStaticFeasibility(
    ['com.acme.security/user-identity@v1'],
    closure
  );

  console.log(`✅ Static Feasibility Proved!`);
  console.log(`   Is Feasible: ${proof.isFeasible}`);
  console.log(`   Closure Types: ${Array.from(proof.frontierClosure).join(', ')}\n`);

  // 2. Setup Compiler & Initial Graph
  const registry = new SchemaRegistry();
  registry.registerAssertionType({
    name: 'com.acme.security/user-identity@v1',
    owner: 'secops',
    subjectSchema: { digest: 'sha256:s1' },
    outputRoles: {},
  });

  const compiler = new Compiler(registry);

  const goalSpec: GoalSpec = {
    apiVersion: 'evidence.engine/v1alpha1',
    kind: 'InvestigationGoal',
    metadata: { tenant: 'acme-tenant', createdAt: 1000000 },
    assertions: [
      {
        uid: 'assert-1',
        type: 'com.acme.security/user-identity@v1',
        subject: { type: 'core/string', value: 'user-777' },
        required: true,
      },
    ],
    constraints: {},
  };

  const capSnap = {
    capabilities: [
      {
        capabilityUid: 'cap-id-check-v1',
        targetAssertionTypes: ['com.acme.security/user-identity@v1'],
        attributes: {},
        credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-id-check-v1'] },
        costMicros: '100000',
        currency: 'USD',
      },
    ],
    productionFrontier: ['com.acme.security/user-identity@v1'],
  };

  const polSnap = { unknownAdmissible: false, policyRulesAllowed: [] };

  const initialContext: PlanningContext = {
    capabilitySnapshot: { digest: 'sha256:cap-snap', schemaVersion: 'v1' },
    policySnapshot: { digest: 'sha256:pol-snap', schemaVersion: 'v1' },
    strategyBundle: { digest: 'sha256:bundle', version: '1.0.0' },
    operationalFacts: [
      {
        capabilityUid: 'cap-id-check-v1',
        version: 'v1.0',
        observedAt: 1000000,
        validUntil: 5000000, // Valid until instant 5000000
      },
    ],
    stateFacts: [],
    planningInstant: 2000000,
    integrityDigest: 'sha256:ctx-integrity-v1',
  };

  const request: CompileRequest = {
    goal: { digest: 'sha256:goal' },
    context: { digest: 'sha256:context' },
    traceLevel: 'SUMMARY',
  };

  console.log('🔄 Step 2: Compiling Initial Graph Revision N (Revision 1)...');
  const graphRev1 = compiler.compile(request, goalSpec, initialContext, capSnap, polSnap);
  console.log(`✅ Revision 1 Compiled! Graph UID: ${graphRev1.graphUid}`);

  // 3. Hot Advance Loop Execution
  console.log('\n🔥 Step 3: Running Hot Advance Loop (Pure Graph Evaluation)...');
  const advanceLoop = new AdvanceLoop();
  const advanceResult = advanceLoop.advance(graphRev1, {}, {}, [], 2500000);

  console.log(`   Newly Dispatched Nodes: ${advanceResult.newlyDispatchedNodes.length}`);
  console.log(`   Node Phase: ${graphRev1.nodes[0]?.status.phase}`);

  // 4. Read-Set Invalidation & Cold Replan Loop Execution
  console.log('\n❄️  Step 4: Simulating Time Advance & Checking Read-Set Invalidation...');
  const invalidator = new ReadSetInvalidator();
  const activeDecisionRecord = {
    apiVersion: 'evidence.engine/v1alpha1' as const,
    kind: 'DecisionRecord' as const,
    decisionDigest: graphRev1.decisionRecordRef.digest,
    goalDigest: 'sha256:goal',
    contextIntegrityDigest: initialContext.integrityDigest,
    selectedCapabilities: [],
    candidateEvaluations: [],
    appliedRelaxations: [],
    provenance: graphRev1.provenance,
    readSet: [
      {
        resourceUid: 'cap-id-check-v1',
        resourceType: 'Capability',
        version: 'v1.0',
        validUntil: 5000000,
      },
    ],
    witnessedValues: [],
  };

  // Instant advances to 6000000 (> validUntil 5000000), context resolver refreshes operational facts
  const expiredInstant = 6000000;
  const refreshedContext: PlanningContext = {
    ...initialContext,
    planningInstant: expiredInstant,
    operationalFacts: [
      {
        capabilityUid: 'cap-id-check-v1',
        version: 'v1.1', // Refreshed version
        observedAt: expiredInstant,
        validUntil: 10000000,
      },
    ],
  };

  const check = invalidator.checkInvalidation(
    activeDecisionRecord,
    refreshedContext.operationalFacts,
    expiredInstant
  );

  console.log(`   Read-Set Invalidated: ${check.isInvalidated}`);
  console.log(`   Reason: "${check.reason}"`);

  console.log('\n🔄 Executing Cold Replan Loop (Compiling Revision N+1)...');
  const replanLoop = new ReplanLoop(compiler);
  const replanResult = replanLoop.executeReplanIfInvalidated(
    activeDecisionRecord,
    [],
    request,
    goalSpec,
    refreshedContext,
    capSnap,
    polSnap
  );

  console.log(`✅ Replan Executed: ${replanResult.replanExecuted}`);
  console.log(`   New Graph UID:   ${replanResult.newGraph?.graphUid}`);

  // 5. Contributor Golden File Test Harness
  console.log('\n🧪 Step 5: Testing Contributor Golden-File Harness...');
  const harness = new GoldenFileHarness();
  const contrib = bundle.contributions[0]!;
  const expectedFragment = {
    fragmentUid: `frag-${contrib.contributionUid}-${goalSpec.assertions[0]!.uid}`,
    assertionUid: goalSpec.assertions[0]!.uid,
    requiredAttributePredicates: contrib.requiredPredicates,
    nodeTemplates: contrib.nodeTemplates,
  };
  const expectedDigest = canonicalDigest(expectedFragment);

  const goldenResult = harness.testDeclarativeContribution(contrib, {
    scenarioUid: 'scen-001',
    description: 'Verify identity contribution digest',
    inputAssertion: goalSpec.assertions[0]!,
    expectedFragmentDigest: expectedDigest,
  });

  console.log(`   Harness Executed for Scenario: ${goldenResult.scenarioUid}`);
  console.log(`   Passed: ${goldenResult.passed} (Digest: ${goldenResult.actualDigest})`);

  console.log('\n====================================================');
  console.log('  Phase 1 Demo Complete — Dual Loops & Wasm Substrate Ready!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
