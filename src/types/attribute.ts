import { DeprecationRecord, NamespacedType, TypedValue } from './core.js';

export type KleeneBool = "TRUE" | "FALSE" | "UNKNOWN";

export interface AttributeDefinition {
  apiVersion: "evidence.engine/v1alpha1";
  kind: "AttributeDefinition";
  name: NamespacedType;
  owner: string;
  valueType: "BOOL" | "ENUM" | "IDENTIFIER" | "INTEGER" | "QUANTITY" | "SET";
  enumValues?: string[];
  unit?: string;
  scale?: number;
  ordering: "NONE" | "TOTAL";
  elementType?: NamespacedType;
  unknownPolicy: "TREAT_AS_UNKNOWN";
  deprecation?: DeprecationRecord;
}

export type Predicate =
  | { op: "EQ" | "NEQ"; attribute: NamespacedType; value: TypedValue }
  | { op: "IN" | "NOT_IN"; attribute: NamespacedType; values: TypedValue[] }
  | { op: "LT" | "LTE" | "GT" | "GTE"; attribute: NamespacedType; value: TypedValue }
  | { op: "SUPERSET_OF" | "INTERSECTS"; attribute: NamespacedType; values: TypedValue[] }
  | { op: "PRESENT" | "ABSENT"; attribute: NamespacedType };
