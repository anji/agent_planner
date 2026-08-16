import { NamespacedType, TypedValue } from './core.js';
import { NodeSpec } from './graph.js';
import { Predicate } from './attribute.js';

export interface RequirementFragment {
  fragmentUid: string;
  assertionUid: string;
  requiredAttributePredicates: Predicate[];
  nodeTemplates: NodeSpec[];
}

export interface DeclarativeContribution {
  kind: "DECLARATIVE";
  contributionUid: string;
  targetAssertionType: NamespacedType;
  outputRoles: string[];
  requiredPredicates: Predicate[];
  nodeTemplates: NodeSpec[];
}

export interface ComputedContribution {
  kind: "COMPUTED";
  contributionUid: string;
  targetAssertionType: NamespacedType;
  wasmModuleDigest: string;
  entryFunction: string;
  fuelBudget: number;
}

export type StrategyContribution = DeclarativeContribution | ComputedContribution;

export interface StrategyBundle {
  bundleUid: string;
  version: string;
  digest: string;
  contributions: StrategyContribution[];
  declaredFrontier: NamespacedType[];
}
