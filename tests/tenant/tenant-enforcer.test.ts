import { describe, expect, it } from 'vitest';
import { TenantShareEnforcer } from '../../src/tenant/tenant-enforcer.js';

describe('Multi-Tenant Share & Concurrency Slot Enforcer', () => {
  const enforcer = new TenantShareEnforcer();
  enforcer.setTenantPolicy({
    tenant: 'tenant-acme',
    concurrencySlots: 2,
    sharePercentage: 50,
  });

  it('grants slots up to maximum limit and rejects when limit is breached', () => {
    const acq1 = enforcer.acquireSlot('tenant-acme');
    expect(acq1.granted).toBe(true);
    expect(acq1.activeSlots).toBe(1);

    const acq2 = enforcer.acquireSlot('tenant-acme');
    expect(acq2.granted).toBe(true);
    expect(acq2.activeSlots).toBe(2);

    // 3rd acquisition exceeds limit of 2
    const acq3 = enforcer.acquireSlot('tenant-acme');
    expect(acq3.granted).toBe(false);
    expect(acq3.reason).toContain('TENANT_CONCURRENCY_EXCEEDED');

    enforcer.releaseSlot('tenant-acme');
    expect(enforcer.getActiveSlots('tenant-acme')).toBe(1);
  });
});
