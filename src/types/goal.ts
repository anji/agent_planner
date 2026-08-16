import { DeprecationRecord, Money, NamespacedType, ObjectMeta, SchemaRef, TypedValue } from './core.js';

export interface GoalInternalBinding {
  source: "GOAL_ASSERTION";
  assertionUid: string;
  outputRole: string;
  expectedType: SchemaRef;
}

export interface GoalAssertion {
  uid: string;
  type: NamespacedType;
  subject: TypedValue | GoalInternalBinding;
  parameters?: Record<string, TypedValue | GoalInternalBinding>;
  required: boolean;
}

export interface GoalConstraints {
  maxSpend?: Money;
  deadline?: number;
  allowedProviderTiers?: string[];
  policyRelaxationsAllowed?: boolean;
}

export interface GoalSpec {
  apiVersion: "evidence.engine/v1alpha1";
  kind: "InvestigationGoal";
  metadata: ObjectMeta;
  assertions: GoalAssertion[];
  constraints: GoalConstraints;
}

export interface AssertionTypeDefinition {
  name: NamespacedType;
  owner: string;
  subjectSchema: SchemaRef;
  parameterSchema?: SchemaRef;
  outputRoles: Record<string, SchemaRef>;
  deprecation?: DeprecationRecord;
}
