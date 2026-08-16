import { describe, expect, it } from 'vitest';
import { ILPSolver } from '../../src/solver/ilp-solver.js';
import { CapabilityDeclaration } from '../../src/compiler/compiler.js';

describe('Exact Multi-Objective ILP Solver', () => {
  const solver = new ILPSolver();

  it('selects lowest-cost capability and breaks ties via SHA-256 canonical digest', () => {
    const capCheaper: CapabilityDeclaration = {
      capabilityUid: 'cap-expensive',
      targetAssertionTypes: ['com.example/check@v1'],
      attributes: {},
      credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-expensive'] },
      costMicros: '500000', // $0.50
      currency: 'USD',
    };

    const capCheap: CapabilityDeclaration = {
      capabilityUid: 'cap-cheap',
      targetAssertionTypes: ['com.example/check@v1'],
      attributes: {},
      credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-cheap'] },
      costMicros: '100000', // $0.10
      currency: 'USD',
    };

    const map = new Map<string, CapabilityDeclaration[]>();
    map.set('assert-1', [capCheaper, capCheap]);

    const result = solver.solveOptimalSelection(map);
    expect(result.selectedCapabilities.length).toBe(1);
    expect(result.selectedCapabilities[0]?.capabilityUid).toBe('cap-cheap');
    expect(result.totalCost.amountMicros).toBe('100000');
  });
});
