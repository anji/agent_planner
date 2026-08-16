import { TenantRef } from '../types/index.js';

export interface TenantQuotaPolicy {
  tenant: TenantRef;
  concurrencySlots: number;
  sharePercentage: number;
}

export interface SlotAcquisitionResult {
  granted: boolean;
  activeSlots: number;
  maxSlots: number;
  reason?: string;
}

/**
 * Multi-Tenant Share & Concurrency Slot Enforcer (§6, §11.3).
 * Manages per-tenant resource isolation, noisy-neighbor protection,
 * and concurrency slot enforcement across execution graphs.
 */
export class TenantShareEnforcer {
  private policies = new Map<string, TenantQuotaPolicy>();
  private activeDispatches = new Map<string, number>();

  public setTenantPolicy(policy: TenantQuotaPolicy): void {
    this.policies.set(policy.tenant, policy);
  }

  public getTenantPolicy(tenant: TenantRef): TenantQuotaPolicy | undefined {
    return this.policies.get(tenant);
  }

  public acquireSlot(tenant: TenantRef): SlotAcquisitionResult {
    const policy = this.policies.get(tenant);
    const maxSlots = policy?.concurrencySlots ?? 10; // Default limit if not explicit
    const current = this.activeDispatches.get(tenant) || 0;

    if (current >= maxSlots) {
      return {
        granted: false,
        activeSlots: current,
        maxSlots,
        reason: `TENANT_CONCURRENCY_EXCEEDED: tenant "${tenant}" reached active slot limit of ${maxSlots}`,
      };
    }

    this.activeDispatches.set(tenant, current + 1);
    return {
      granted: true,
      activeSlots: current + 1,
      maxSlots,
    };
  }

  public releaseSlot(tenant: TenantRef): void {
    const current = this.activeDispatches.get(tenant) || 0;
    if (current > 0) {
      this.activeDispatches.set(tenant, current - 1);
    }
  }

  public getActiveSlots(tenant: TenantRef): number {
    return this.activeDispatches.get(tenant) || 0;
  }
}
