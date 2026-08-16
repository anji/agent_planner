import { canonicalDigest, canonicalizeJson } from '../canonical/jcs.js';
import { evaluatePredicate } from '../predicate/evaluator.js';
import { SchemaRegistry } from '../registry/attribute-registry.js';
import { FrontierClosureEngine } from './frontier-closure.js';
import { ILPSolver } from '../solver/ilp-solver.js';
import { createKeyedPersonalCommitment } from '../storage/crypto-shredded-store.js';
import {
  AppliedRelaxation,
  CandidateEvaluation,
  CompileRequest,
  ContentRef,
  CredentialScope,
  DecisionRecord,
  DecisiveConstraint,
  ExecutionGraph,
  GoalAssertion,
  GoalSpec,
  GraphEdge,
  GraphNode,
  GraphStatus,
  NodeDataFlow,
  NodeSpec,
  PlanningContext,
  Predicate,
  ReadSetEntry,
  SelectedCapability,
  StrategyBundle,
  TypedValue,
  UnmetAssertion,
  WitnessedValue,
} from '../types/index.js';

export interface CapabilityDeclaration {
  capabilityUid: string;
  targetAssertionTypes: string[];
  attributes: Record<string, TypedValue>;
  costMicros: string;
  currency: string;
  credentialScope?: CredentialScope; // Structurally typed CredentialScope (§11.5)
  predicates?: Predicate[];
  isPersonalData?: boolean;
}

export interface CapabilitySnapshot {
  capabilities: CapabilityDeclaration[];
  productionFrontier: string[];
}

export interface PolicySnapshot {
  unknownAdmissible: boolean;
  policyRulesAllowed: string[];
}

export class CompilerError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/**
 * Pure 10-step Compiler Engine (§8, §8.1).
 * Never reads system clock; planningInstant is passed as data.
 */
export class Compiler {
  private frontierEngine = new FrontierClosureEngine();
  private ilpSolver = new ILPSolver();

  constructor(private registry: SchemaRegistry) {}

  public compile(
    request: CompileRequest,
    goalSpec: GoalSpec,
    context: PlanningContext,
    capabilitySnapshot: CapabilitySnapshot,
    policySnapshot: PolicySnapshot,
    bundles: StrategyBundle[] = []
  ): ExecutionGraph {
    // Step 1: Referential integrity check (§7.2 - all 4 checks)
    this.verifyReferentialIntegrity(context, capabilitySnapshot);

    const goalDigest = request.goal.digest || canonicalDigest(goalSpec);
    const contextIntegrityDigest = context.integrityDigest || this.computeContextIntegrityDigest(context);

    // Step 2 & 3: Resolve assertions and match strategy contributions with deprecation tracking
    const resolvedAssertions: { assertion: GoalAssertion; resolvedType: string; deprecationResolved: boolean }[] = [];
    const unmetAssertions: UnmetAssertion[] = [];
    const typeResolutions: { originalType: string; resolvedType: string; status: string }[] = [];

    for (const assertion of goalSpec.assertions) {
      try {
        const resolution = this.registry.resolveAssertionType(assertion.type);
        resolvedAssertions.push({
          assertion,
          resolvedType: resolution.resolvedType,
          deprecationResolved: resolution.hops > 0,
        });

        if (resolution.hops > 0) {
          typeResolutions.push({
            originalType: assertion.type,
            resolvedType: resolution.resolvedType,
            status: resolution.status,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        unmetAssertions.push({
          assertionUid: assertion.uid,
          reasonCode: 'TYPE_RESOLUTION_FAILED',
          message: msg,
        });
      }
    }

    // Step 4 & 5: Expand contributions & semilattice conjunction merge (§9.3, AC-8)
    const requiredPredicatesByAssertion = new Map<string, Predicate[]>();
    for (const item of resolvedAssertions) {
      const predMap = new Map<string, Predicate>();
      for (const bundle of bundles) {
        for (const contrib of bundle.contributions) {
          if (contrib.targetAssertionType === item.resolvedType && contrib.kind === 'DECLARATIVE') {
            for (const pred of contrib.requiredPredicates) {
              const digest = canonicalDigest(pred);
              if (!predMap.has(digest)) {
                predMap.set(digest, pred);
              }
            }
          }
        }
      }
      // Content-keyed set union sorted deterministically by canonical digest string (§9.3, AC-8)
      const sortedMergedPredicates = Array.from(predMap.entries())
        .sort(([digestA], [digestB]) => digestA < digestB ? -1 : digestA > digestB ? 1 : 0)
        .map(([, pred]) => pred);

      requiredPredicatesByAssertion.set(item.assertion.uid, sortedMergedPredicates);
    }

    const appliedRelaxations: AppliedRelaxation[] = [];

    // Step 6: Static infeasibility check against production frontier closure (§10.2)
    const frontierClosure = this.frontierEngine.computeFrontierClosure(bundles);
    if (bundles.length === 0) {
      for (const targetType of capabilitySnapshot.productionFrontier) {
        frontierClosure.add(targetType);
      }
    }

    const feasibilityProof = this.frontierEngine.proveStaticFeasibility(
      resolvedAssertions.map(r => r.resolvedType),
      frontierClosure
    );

    if (!feasibilityProof.isFeasible) {
      for (const missing of feasibilityProof.missingAssertionTypes) {
        const targetAssertion = resolvedAssertions.find(r => r.resolvedType === missing)?.assertion;
        if (targetAssertion) {
          unmetAssertions.push({
            assertionUid: targetAssertion.uid,
            reasonCode: 'FRONTIER_VIOLATION',
            message: `Goal assertion type "${missing}" is outside the strategy bundle production frontier.`,
          });
        }
      }
    }

    // Step 7 & 8: Candidate capability filtering & exact ILP optimization
    const candidateEvaluations: CandidateEvaluation[] = [];
    const selectedCapabilities: SelectedCapability[] = [];
    const readSetMap = new Map<string, ReadSetEntry>();
    const witnessedValues: WitnessedValue[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const assertionToNodeUid = new Map<string, string>();

    let nodeCounter = 1;

    for (const item of resolvedAssertions) {
      const assertion = item.assertion;
      const targetType = item.resolvedType;

      const candidates = capabilitySnapshot.capabilities.filter(c =>
        c.targetAssertionTypes.includes(targetType)
      );

      const eligibleCandidates: CapabilityDeclaration[] = [];

      for (const cand of candidates) {
        // Read-set deduplicated recording
        const opFact = context.operationalFacts.find(f => f.capabilityUid === cand.capabilityUid);
        if (opFact && !readSetMap.has(cand.capabilityUid)) {
          readSetMap.set(cand.capabilityUid, {
            resourceUid: cand.capabilityUid,
            resourceType: 'Capability',
            version: opFact.version,
            validUntil: opFact.validUntil,
          });
        }

        // Merge capability predicates and strategy predicates in canonical digest order
        const candPredMap = new Map<string, Predicate>();
        for (const pred of [...(cand.predicates || []), ...(requiredPredicatesByAssertion.get(assertion.uid) || [])]) {
          const digest = canonicalDigest(pred);
          if (!candPredMap.has(digest)) {
            candPredMap.set(digest, pred);
          }
        }
        const mergedPredicates = Array.from(candPredMap.entries())
          .sort(([dA], [dB]) => dA < dB ? -1 : dA > dB ? 1 : 0)
          .map(([, p]) => p);

        // Strict data minimization: record witnessed values only for attributes referenced in evaluated predicates (§13)
        const referencedAttrNames = new Set(mergedPredicates.map(p => p.attribute));
        for (const [attrName, val] of Object.entries(cand.attributes)) {
          if (!referencedAttrNames.has(attrName) && mergedPredicates.length > 0) {
            continue; // Data minimization under §13
          }

          const realSubjectId = typeof assertion.subject === 'object' && assertion.subject !== null && 'value' in assertion.subject
            ? String((assertion.subject as TypedValue).value)
            : assertion.uid;

          const isPersonal = cand.isPersonalData || false;
          if (isPersonal) {
            let subjectKey: Buffer | undefined;
            if (context.subjectKeys) {
              if (context.subjectKeys instanceof Map) {
                subjectKey = context.subjectKeys.get(realSubjectId) || context.subjectKeys.get(assertion.uid);
              } else {
                const keys = context.subjectKeys as Record<string, Buffer>;
                subjectKey = keys[realSubjectId] || keys[assertion.uid];
              }
            }
            if (!subjectKey) {
              throw new CompilerError(
                'SUBJECT_KEY_UNAVAILABLE',
                `Subject key for "${realSubjectId}" is missing in PlanningContext.subjectKeys for personal data assertion "${assertion.uid}". Compilation rejected.`
              );
            }

            const valueRef = createKeyedPersonalCommitment(subjectKey, attrName, val);
            witnessedValues.push({
              attributeName: attrName,
              subjectId: realSubjectId,
              valueRef,
              isPersonalData: true,
            });
          } else {
            witnessedValues.push({
              attributeName: attrName,
              subjectId: realSubjectId,
              value: val,
              isPersonalData: false,
            });
          }
        }

        // Evaluate conjunction and collect failing predicates
        let eligible = true;
        let decisiveCode = 'MATCHED';
        let decisivePred: Predicate | undefined;
        let evaluatedTruth: 'TRUE' | 'FALSE' | 'UNKNOWN' = 'TRUE';

        const failingPreds: { pred: Predicate; truth: 'FALSE' | 'UNKNOWN' }[] = [];
        for (const pred of mergedPredicates) {
          const truth = evaluatePredicate(pred, cand.attributes, this.registry);
          if (truth === 'FALSE' || (truth === 'UNKNOWN' && !policySnapshot.unknownAdmissible)) {
            failingPreds.push({ pred, truth });
          }
        }

        if (failingPreds.length > 0) {
          // Process policy relaxation as a post-conjunction set (§9.4)
          for (const failing of failingPreds) {
            const removesDigest = canonicalDigest(failing.pred);
            if (goalSpec.constraints.policyRelaxationsAllowed && policySnapshot.policyRulesAllowed.includes(removesDigest)) {
              appliedRelaxations.push({
                policyRuleId: removesDigest,
                targetAssertionUid: assertion.uid,
                justificationCode: 'POLICY_RELAXATION_APPLIED',
              });
            } else {
              eligible = false;
              decisiveCode = failing.truth === 'FALSE' ? 'PREDICATE_FALSE' : 'UNKNOWN_INADMISSIBLE';
              decisivePred = failing.pred;
              evaluatedTruth = failing.truth;
              break;
            }
          }
        }

        if (!eligible) {
          const constraint: DecisiveConstraint = {
            code: decisiveCode,
            evaluatedTruth,
            message: `Capability ${cand.capabilityUid} failed predicate check: ${decisiveCode}`,
          };
          if (decisivePred) {
            constraint.predicate = decisivePred;
          }
          candidateEvaluations.push({
            capabilityUid: cand.capabilityUid,
            targetAssertionUid: assertion.uid,
            outcome: 'INELIGIBLE',
            costMicros: cand.costMicros,
            currency: cand.currency,
            decisiveConstraint: constraint,
          });
        } else {
          eligibleCandidates.push(cand);
        }
      }

      if (eligibleCandidates.length === 0) {
        unmetAssertions.push({
          assertionUid: assertion.uid,
          reasonCode: 'UNSATISFIABLE',
          message: `No eligible capability found matching predicates for assertion "${assertion.uid}"`,
        });
        continue;
      }

      // Exact ILP Cost Minimization & Digest Tie-breaker
      const solverMap = new Map<string, CapabilityDeclaration[]>();
      solverMap.set(assertion.uid, eligibleCandidates);
      const solverResult = this.ilpSolver.solveOptimalSelection(solverMap);

      const winningCandidate = solverResult.selectedCapabilities[0]!;

      // Mark winner as SELECTED (with recorded candidate cost for offline cost verification - §8.1)
      candidateEvaluations.push({
        capabilityUid: winningCandidate.capabilityUid,
        targetAssertionUid: assertion.uid,
        outcome: 'SELECTED',
        costMicros: winningCandidate.costMicros,
        currency: winningCandidate.currency,
      });

      // Mark non-chosen eligible candidates as REJECTED with decisive constraint (with recorded candidate cost - §8.1)
      for (const otherCand of eligibleCandidates) {
        if (otherCand.capabilityUid !== winningCandidate.capabilityUid) {
          candidateEvaluations.push({
            capabilityUid: otherCand.capabilityUid,
            targetAssertionUid: assertion.uid,
            outcome: 'REJECTED',
            costMicros: otherCand.costMicros,
            currency: otherCand.currency,
            decisiveConstraint: {
              code: 'OUT_COMPETED_ON_COST',
              evaluatedTruth: 'TRUE',
              message: `Out-competed on monetary cost/objective by selected candidate "${winningCandidate.capabilityUid}"`,
            },
          });
        }
      }

      selectedCapabilities.push({
        capabilityUid: winningCandidate.capabilityUid,
        targetAssertionUid: assertion.uid,
        decisiveAttributes: winningCandidate.attributes,
      });

      // Step 9: Compile Graph Nodes & Edges (AC-27 Output role validation & CredentialScope §11.5)
      const nodeUid = `node-${nodeCounter++}`;
      assertionToNodeUid.set(assertion.uid, nodeUid);

      // §11.5: EVERY core/ACQUIRE node carries a CredentialScope. Absence is a typed
      // refusal, never a skipped check — an unbrokered ACQUIRE must be unrepresentable.
      if (!winningCandidate.credentialScope) {
        throw new CompilerError(
          'CREDENTIAL_SCOPE_REQUIRED',
          `Capability "${winningCandidate.capabilityUid}" selected for assertion "${assertion.uid}" declares no CredentialScope. ` +
            `Every core/ACQUIRE node MUST carry one (§11.5); compilation rejected.`
        );
      }

      const nodeSpec: NodeSpec = {
        capabilityUid: winningCandidate.capabilityUid,
        credentialScope: winningCandidate.credentialScope,
      };

      const dataFlow: NodeDataFlow = {
        inputBindings: {},
      };

      if (typeof assertion.subject === 'object' && 'type' in assertion.subject) {
        nodeSpec.requestTemplate = assertion.subject as TypedValue;
      } else if (typeof assertion.subject === 'object' && 'source' in assertion.subject) {
        const binding = assertion.subject;

        // AC-27 Output role validation
        const upstreamAssertion = goalSpec.assertions.find(a => a.uid === binding.assertionUid);
        if (upstreamAssertion) {
          const upstreamType = this.registry.getAssertionType(upstreamAssertion.type);
          if (upstreamType && upstreamType.outputRoles && !upstreamType.outputRoles[binding.outputRole]) {
            throw new CompilerError(
              'INVALID_OUTPUT_ROLE',
              `Output role "${binding.outputRole}" is not a declared output role on assertion type "${upstreamAssertion.type}" (AC-27)`
            );
          }
        }

        const producerNodeUid = assertionToNodeUid.get(binding.assertionUid) || 'node-1';

        dataFlow.inputBindings[binding.outputRole] = {
          source: 'NODE_OUTPUT',
          role: binding.outputRole,
          sourceNodeUid: producerNodeUid,
          path: `${producerNodeUid}.${binding.outputRole}`,
        };

        edges.push({
          fromNodeUid: producerNodeUid,
          toNodeUid: nodeUid,
          bindingRole: binding.outputRole,
        });

        nodeSpec.requestTemplate = {
          type: 'core/binding-ref',
          value: `${producerNodeUid}.${binding.outputRole}`,
        };
      }

      nodes.push({
        uid: nodeUid,
        kind: 'core/ACQUIRE',
        spec: nodeSpec,
        dataFlow,
        status: {
          phase: 'PENDING',
          attempts: [],
          lastTransitionAt: context.planningInstant,
        },
      });
    }

    // Determine Graph Status
    let status: GraphStatus = 'READY';
    const hasUnmetRequired = unmetAssertions.some(u => {
      const a = goalSpec.assertions.find(ass => ass.uid === u.assertionUid);
      return a ? a.required : false;
    });

    if (hasUnmetRequired) {
      status = 'UNSATISFIABLE';
    } else if (unmetAssertions.length > 0) {
      status = 'PARTIAL';
    }

    // Canonical Sorting of collections for Permutation-Stable Decision Record Digest (AC-2)
    const sortedSelectedCapabilities = [...selectedCapabilities].sort((a, b) => {
      if (a.targetAssertionUid !== b.targetAssertionUid) return a.targetAssertionUid < b.targetAssertionUid ? -1 : 1;
      return a.capabilityUid < b.capabilityUid ? -1 : a.capabilityUid > b.capabilityUid ? 1 : 0;
    });

    const sortedCandidateEvaluations = [...candidateEvaluations].sort((a, b) => {
      if (a.targetAssertionUid !== b.targetAssertionUid) return a.targetAssertionUid < b.targetAssertionUid ? -1 : 1;
      return a.capabilityUid < b.capabilityUid ? -1 : a.capabilityUid > b.capabilityUid ? 1 : 0;
    });

    const sortedReadSet = Array.from(readSetMap.values()).sort((a, b) =>
      a.resourceUid < b.resourceUid ? -1 : a.resourceUid > b.resourceUid ? 1 : 0
    );

    const sortedWitnessedValues = [...witnessedValues].sort((a, b) => {
      if (a.subjectId !== b.subjectId) return a.subjectId < b.subjectId ? -1 : 1;
      if (a.attributeName !== b.attributeName) return a.attributeName < b.attributeName ? -1 : 1;
      const keyA = a.valueRef?.digest || canonicalizeJson(a.value);
      const keyB = b.valueRef?.digest || canonicalizeJson(b.value);
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });

    // Step 10: Emit Decision Record
    const decisionRecordPayload = {
      apiVersion: 'evidence.engine/v1alpha1' as const,
      kind: 'DecisionRecord' as const,
      decisionDigest: '',
      goalDigest,
      contextIntegrityDigest,
      selectedCapabilities: sortedSelectedCapabilities,
      candidateEvaluations: sortedCandidateEvaluations,
      appliedRelaxations,
      provenance: {
        compilerVersion: '0.1.0',
        solverAlgorithm: 'exact_ilp_multiobj_v1',
        bundleDigest: context.strategyBundle.digest,
        timestamp: context.planningInstant,
        typeResolutions: typeResolutions.length > 0 ? typeResolutions : undefined,
      },
      readSet: sortedReadSet,
      witnessedValues: sortedWitnessedValues,
    };

    const decisionDigest = canonicalDigest(decisionRecordPayload);
    const decisionRecord: DecisionRecord = {
      ...decisionRecordPayload,
      decisionDigest,
    };

    const decisionRecordRef: ContentRef = {
      digest: decisionDigest,
      mediaType: 'application/json+decision-record',
      sizeBytes: Buffer.byteLength(canonicalizeJson(decisionRecord), 'utf8'),
    };

    const graphUid = `graph-${goalDigest.substring(7, 15)}`;
    const investigationUid = request.investigationUid ||
      (goalSpec.metadata.investigationUid as string) ||
      (goalSpec.metadata.tenant ? `inv-${goalSpec.metadata.tenant}-${goalDigest.substring(7, 15)}` : `inv-${goalDigest.substring(7, 15)}`);

    return {
      graphUid,
      investigationUid,
      metadata: goalSpec.metadata as unknown as Record<string, unknown>,
      provenance: decisionRecord.provenance,
      nodes,
      edges,
      status,
      unmetAssertions,
      decisionRecordRef,
    };
  }

  public verifyReferentialIntegrity(
    context: PlanningContext,
    capabilitySnapshot: CapabilitySnapshot
  ): void {
    // 1. Operational facts referential integrity check (§7.2 check #1)
    const capUids = new Set(capabilitySnapshot.capabilities.map(c => c.capabilityUid));
    for (const fact of context.operationalFacts) {
      if (!capUids.has(fact.capabilityUid)) {
        throw new CompilerError(
          'CONTEXT_INTEGRITY_VIOLATION',
          `Operational fact references unknown capabilityUid "${fact.capabilityUid}"`
        );
      }
      if (fact.observedAt > context.planningInstant) {
        throw new CompilerError(
          'CONTEXT_INTEGRITY_VIOLATION',
          `Operational fact observedAt (${fact.observedAt}) is after planningInstant (${context.planningInstant})`
        );
      }
      if (context.planningInstant >= fact.validUntil) {
        throw new CompilerError(
          'CONTEXT_INTEGRITY_VIOLATION',
          `Operational fact expired: planningInstant (${context.planningInstant}) >= validUntil (${fact.validUntil})`
        );
      }
    }

    // 2. Capability snapshot digest check (§7.2 check #2)
    if (!context.capabilitySnapshot || !context.capabilitySnapshot.digest) {
      throw new CompilerError(
        'CONTEXT_INTEGRITY_VIOLATION',
        'PlanningContext missing valid capabilitySnapshot digest'
      );
    }

    // 3. Policy snapshot digest check (§7.2 check #3)
    if (!context.policySnapshot || !context.policySnapshot.digest) {
      throw new CompilerError(
        'CONTEXT_INTEGRITY_VIOLATION',
        'PlanningContext missing valid policySnapshot digest'
      );
    }

    // 4. Strategy bundle digest check (§7.2 check #4)
    if (!context.strategyBundle || !context.strategyBundle.digest) {
      throw new CompilerError(
        'CONTEXT_INTEGRITY_VIOLATION',
        'PlanningContext missing valid strategyBundle digest'
      );
    }
  }

  public computeContextIntegrityDigest(context: PlanningContext): string {
    const tuple = {
      capabilitySnapshotDigest: context.capabilitySnapshot.digest,
      policySnapshotDigest: context.policySnapshot.digest,
      exchangeRateSnapshotDigest: context.exchangeRateSnapshot?.digest,
      strategyBundleDigest: context.strategyBundle.digest,
      operationalFacts: [...context.operationalFacts]
        .sort((a, b) => a.capabilityUid < b.capabilityUid ? -1 : a.capabilityUid > b.capabilityUid ? 1 : 0)
        .map(f => ({
          capabilityUid: f.capabilityUid,
          version: f.version,
          validUntil: f.validUntil,
        })),
      stateFacts: context.stateFacts.map(s => ({
        address: s.address,
        version: s.version,
      })),
      planningInstant: context.planningInstant,
    };
    return canonicalDigest(tuple);
  }
}
