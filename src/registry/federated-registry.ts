import { SchemaRegistry } from './attribute-registry.js';
import { AssertionTypeDefinition, AttributeDefinition, NamespacedType } from '../types/index.js';

export interface FederatedResolution {
  sourceRegistryId: string;
  definition: AssertionTypeDefinition;
}

/**
 * Federated Schema Registry (§14, Architecture §6).
 * Federation layer linking multi-tenant, dark-namespaced registries
 * across trust boundaries with ownership transfers.
 */
export class FederatedRegistry {
  private registries = new Map<string, SchemaRegistry>();

  public registerChildRegistry(id: string, registry: SchemaRegistry): void {
    this.registries.set(id, registry);
  }

  public findAssertionType(type: NamespacedType): FederatedResolution | undefined {
    for (const [id, reg] of this.registries.entries()) {
      const def = reg.getAssertionType(type);
      if (def) {
        return {
          sourceRegistryId: id,
          definition: def,
        };
      }
    }
    return undefined;
  }

  public findAttribute(name: NamespacedType): AttributeDefinition | undefined {
    for (const reg of this.registries.values()) {
      const attr = reg.getAttribute(name);
      if (attr) return attr;
    }
    return undefined;
  }
}
