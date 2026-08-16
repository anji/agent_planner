import { NamespacedType } from '../types/index.js';

export interface CompatibilitySet {
  compatibilitySetUid: string;
  plannerApiVersion: string;
  strategyInterfaceVersion: string;
  supportedAssertionTypes: NamespacedType[];
  supportedCapabilitySchemas: NamespacedType[];
  supportedAttributeDefinitions: NamespacedType[];
}

export interface SkewValidationResult {
  isCompatible: boolean;
  skewErrors: string[];
}

/**
 * Compatibility Registry (§14, Architecture §6).
 * Validates cross-version skew across assertion types, capability schemas,
 * attribute definitions, strategy interface, and planner API version.
 */
export class CompatibilityRegistry {
  private sets = new Map<string, CompatibilitySet>();

  public registerCompatibilitySet(set: CompatibilitySet): void {
    this.sets.set(set.compatibilitySetUid, set);
  }

  public getCompatibilitySet(uid: string): CompatibilitySet | undefined {
    return this.sets.get(uid);
  }

  public validateCompatibility(
    setUid: string,
    assertionType: NamespacedType,
    capabilitySchema: NamespacedType,
    attributeDef: NamespacedType
  ): SkewValidationResult {
    const set = this.sets.get(setUid);
    if (!set) {
      return {
        isCompatible: false,
        skewErrors: [`CompatibilitySet "${setUid}" not found in registry.`],
      };
    }

    const errors: string[] = [];

    if (!set.supportedAssertionTypes.includes(assertionType)) {
      errors.push(`Assertion type "${assertionType}" is not in CompatibilitySet "${setUid}".`);
    }
    if (!set.supportedCapabilitySchemas.includes(capabilitySchema)) {
      errors.push(`Capability schema "${capabilitySchema}" is not in CompatibilitySet "${setUid}".`);
    }
    if (!set.supportedAttributeDefinitions.includes(attributeDef)) {
      errors.push(`Attribute definition "${attributeDef}" is not in CompatibilitySet "${setUid}".`);
    }

    return {
      isCompatible: errors.length === 0,
      skewErrors: errors,
    };
  }
}
