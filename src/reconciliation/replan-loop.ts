import { Compiler, CapabilitySnapshot, PolicySnapshot } from '../compiler/compiler.js';
import { classifyAttemptAcrossRevision, ClassificationResult } from '../execution/disposition.js';
import { ReadSetInvalidator } from './read-set-invalidator.js';
import {
  CompileRequest,
  DecisionRecord,
  ExecutionGraph,
  GoalSpec,
  NodeAttemptIntent,
  PlanningContext,
} from '../types/index.js';

export interface ReplanResult {
  replanExecuted: boolean;
  newGraph?: ExecutionGraph;
  attemptClassifications: ClassificationResult[];
  reason?: string;
}

/**
 * Cold Replan Loop (§11.2, Architecture §3).
 * Triggered ONLY on read-set invalidation:
 * 1. Invokes Compiler to produce revision N+1 graph and decision record.
 * 2. Classifies in-flight attempts across graph revisions (CARRIED, ORPHANED, QUIESCED).
 * 3. Publishes new graph revision.
 */
export class ReplanLoop {
  private invalidator = new ReadSetInvalidator();

  constructor(private compiler: Compiler) {}

  public executeReplanIfInvalidated(
    activeDecisionRecord: DecisionRecord,
    inFlightIntents: NodeAttemptIntent[],
    request: CompileRequest,
    goalSpec: GoalSpec,
    context: PlanningContext,
    capabilitySnapshot: CapabilitySnapshot,
    policySnapshot: PolicySnapshot
  ): ReplanResult {
    // 1. Check read-set invalidation
    const check = this.invalidator.checkInvalidation(
      activeDecisionRecord,
      context.operationalFacts,
      context.planningInstant
    );

    if (!check.isInvalidated) {
      return {
        replanExecuted: false,
        attemptClassifications: [],
        reason: 'Read-set remains valid; no replan required.',
      };
    }

    // 2. Re-compile into revision N+1
    const newGraph = this.compiler.compile(
      request,
      goalSpec,
      context,
      capabilitySnapshot,
      policySnapshot
    );

    // 3. Classify in-flight attempts across revision boundary
    const attemptClassifications = inFlightIntents.map(intent =>
      classifyAttemptAcrossRevision(intent, newGraph)
    );

    const result: ReplanResult = {
      replanExecuted: true,
      newGraph,
      attemptClassifications,
    };

    if (check.reason) {
      result.reason = check.reason;
    }

    return result;
  }
}
