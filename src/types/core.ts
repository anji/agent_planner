export type TenantRef = string;
export type EpochMicros = number;
export type NamespacedType = string;

export interface ObjectMeta {
  tenant: TenantRef;
  createdAt: EpochMicros;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  investigationUid?: string;
}

export interface Money {
  amountMicros: string;
  currency: string;
}

export interface CredentialScope {
  scopeId: string;
  allowedCapabilities: string[];
  maxBudgetMicros?: string;
}

export interface SchemaRef {
  digest: string;
  uri?: string;
}

export interface ContentRef {
  digest: string;
  mediaType: string;
  sizeBytes: number;
}

export interface TypedValue {
  type: NamespacedType;
  value: unknown;
}

export interface DeprecationRecord {
  status: "ACTIVE" | "DEPRECATED" | "SUNSET" | "WITHDRAWN";
  deprecatedAt?: EpochMicros;
  sunsetAt?: EpochMicros;
  replacementType?: NamespacedType;
  reason?: string;
}
