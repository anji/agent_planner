import { AssertionTypeDefinition, AttributeDefinition, NamespacedType } from '../types/index.js';

export interface DeprecationResolution {
  definition: AssertionTypeDefinition;
  originalType: NamespacedType;
  resolvedType: NamespacedType;
  hops: number;
  status: "ACTIVE" | "DEPRECATED" | "SUNSET";
  diagnostics: string[];
}

export class SchemaRegistry {
  private attributes = new Map<string, AttributeDefinition>();
  private assertionTypes = new Map<string, AssertionTypeDefinition>();

  public registerAttribute(attr: AttributeDefinition): void {
    this.attributes.set(attr.name, attr);
  }

  public getAttribute(name: NamespacedType): AttributeDefinition | undefined {
    return this.attributes.get(name);
  }

  public registerAssertionType(def: AssertionTypeDefinition): void {
    this.assertionTypes.set(def.name, def);
  }

  public getAssertionType(name: NamespacedType): AssertionTypeDefinition | undefined {
    return this.assertionTypes.get(name);
  }

  /**
   * Resolves assertion types through deprecation ladders transitively (§7.1).
   * Rejects WITHDRAWN types or cycles exceeding maxHops.
   */
  public resolveAssertionType(name: NamespacedType, maxHops = 8): DeprecationResolution {
    let currentName = name;
    let hops = 0;
    const diagnostics: string[] = [];
    const visited = new Set<string>();

    while (hops <= maxHops) {
      if (visited.has(currentName)) {
        throw new Error(`Deprecation resolution cycle detected for type "${currentName}"`);
      }
      visited.add(currentName);

      const def = this.assertionTypes.get(currentName);
      if (!def) {
        throw new Error(`Assertion type "${currentName}" not found in registry`);
      }

      if (!def.deprecation || def.deprecation.status === 'ACTIVE') {
        return {
          definition: def,
          originalType: name,
          resolvedType: currentName,
          hops,
          status: hops > 0 ? 'DEPRECATED' : 'ACTIVE',
          diagnostics,
        };
      }

      if (def.deprecation.status === 'WITHDRAWN') {
        const replacement = def.deprecation.replacementType || 'none';
        throw new Error(
          `Assertion type "${currentName}" is WITHDRAWN. Last known replacement: "${replacement}". Goal submission rejected.`
        );
      }

      // DEPRECATED or SUNSET
      if (def.deprecation.status === 'DEPRECATED') {
        diagnostics.push(`Type "${currentName}" is DEPRECATED. Resolving to "${def.deprecation.replacementType}"`);
      } else if (def.deprecation.status === 'SUNSET') {
        diagnostics.push(`Type "${currentName}" is SUNSET. Resolving to "${def.deprecation.replacementType}"`);
      }

      if (!def.deprecation.replacementType) {
        // Deprecated/Sunset with no replacement available
        return {
          definition: def,
          originalType: name,
          resolvedType: currentName,
          hops,
          status: def.deprecation.status,
          diagnostics,
        };
      }

      currentName = def.deprecation.replacementType;
      hops++;
    }

    throw new Error(`Deprecation resolution hop limit (${maxHops}) exceeded starting from "${name}"`);
  }
}
