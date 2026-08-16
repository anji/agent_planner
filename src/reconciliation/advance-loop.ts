import { evaluateCondition } from '../predicate/condition-evaluator.js';
import { Binding, EpochMicros, ExecutionGraph, GraphNode, KleeneBool, NodeAttemptOutcome, TypedValue } from '../types/index.js';

export interface TransitionEvent {
  nodeUid: string;
  fromPhase: string;
  toPhase: string;
  timestamp: EpochMicros;
}

export interface AdvanceLoopResult {
  graph: ExecutionGraph;
  newlyDispatchedNodes: GraphNode[];
  transitions: TransitionEvent[];
}

/**
 * Hot Advance Loop (§11.2, Architecture §3).
 *
 * Runs pure graph evaluation in milliseconds:
 * 1. Evaluates pending node bindings and condition expressions.
 * 2. Updates NodeStatus phases (PENDING -> READY -> DISPATCHED -> SUCCEEDED/FAILED).
 * 3. Schedules newly-ready nodes.
 * 4. NEVER calls compiler, solver, or strategy bundles.
 */
export class AdvanceLoop {
  public advance(
    graph: ExecutionGraph,
    stateFactValues: Record<string, TypedValue>,
    nodeOutputs: Record<string, TypedValue>,
    incomingOutcomes: NodeAttemptOutcome[],
    currentInstant: EpochMicros
  ): AdvanceLoopResult {
    const transitions: TransitionEvent[] = [];
    const newlyDispatchedNodes: GraphNode[] = [];

    // Helper binding resolver
    const resolveBinding = (binding: Binding): TypedValue | undefined => {
      if (binding.source === 'STATE' && binding.path) {
        return stateFactValues[binding.path];
      }
      if (binding.source === 'NODE_OUTPUT' && binding.path) {
        return nodeOutputs[binding.path];
      }
      return undefined;
    };

    // 1. Process incoming attempt outcomes
    for (const outcome of incomingOutcomes) {
      const node = graph.nodes.find(n => n.uid === outcome.nodeUid);
      if (node && (node.status.phase === 'DISPATCHED' || node.status.phase === 'PENDING')) {
        const fromPhase = node.status.phase;
        let toPhase: "SUCCEEDED" | "FAILED" | "CANCELLED" = "SUCCEEDED";

        if (outcome.status === 'SUCCESS' || outcome.status === 'SUCCEEDED') toPhase = 'SUCCEEDED';
        else if (outcome.status === 'FAILURE' || outcome.status === 'FAILED') toPhase = 'FAILED';
        else toPhase = 'CANCELLED';

        node.status.phase = toPhase;
        node.status.lastTransitionAt = currentInstant;

        transitions.push({
          nodeUid: node.uid,
          fromPhase,
          toPhase,
          timestamp: currentInstant,
        });
      }
    }

    // 2. Re-evaluate conditions for PENDING nodes
    for (const node of graph.nodes) {
      if (node.status.phase === 'PENDING') {
        if (node.spec.condition) {
          const conditionTruth: KleeneBool = evaluateCondition(node.spec.condition, resolveBinding);
          node.status.conditionValue = conditionTruth;

          if (conditionTruth === 'TRUE') {
            // Transition PENDING -> READY -> DISPATCHED
            transitions.push({
              nodeUid: node.uid,
              fromPhase: 'PENDING',
              toPhase: 'READY',
              timestamp: currentInstant,
            });

            node.status.phase = 'DISPATCHED';
            node.status.lastTransitionAt = currentInstant;

            transitions.push({
              nodeUid: node.uid,
              fromPhase: 'READY',
              toPhase: 'DISPATCHED',
              timestamp: currentInstant,
            });

            newlyDispatchedNodes.push(node);
          }
        } else {
          // No condition -> READY immediately
          node.status.phase = 'DISPATCHED';
          node.status.lastTransitionAt = currentInstant;

          transitions.push({
            nodeUid: node.uid,
            fromPhase: 'PENDING',
            toPhase: 'DISPATCHED',
            timestamp: currentInstant,
          });

          newlyDispatchedNodes.push(node);
        }
      }
    }

    // Update overall graph status if all nodes completed
    const allSucceeded = graph.nodes.every(n => n.status.phase === 'SUCCEEDED');
    if (allSucceeded) {
      graph.status = 'READY';
    }

    return {
      graph,
      newlyDispatchedNodes,
      transitions,
    };
  }
}
