import { describe, expect, it } from 'vitest';
import { FrontierClosureEngine } from '../../src/compiler/frontier-closure.js';
import { StrategyBundle } from '../../src/types/index.js';

describe('Transitive Production Frontier Closure Engine', () => {
  const engine = new FrontierClosureEngine();

  const bundle: StrategyBundle = {
    bundleUid: 'bundle-alpha',
    version: '1.0.0',
    digest: 'sha256:b1',
    declaredFrontier: ['com.example/user-location@v1', 'com.example/user-device@v1'],
    contributions: [
      {
        kind: 'DECLARATIVE',
        contributionUid: 'c1',
        targetAssertionType: 'com.example/user-location@v1',
        outputRoles: ['location-record'],
        requiredPredicates: [],
        nodeTemplates: [],
      },
    ],
  };

  it('computes transitive production frontier closure', () => {
    const closure = engine.computeFrontierClosure([bundle]);
    expect(closure.has('com.example/user-location@v1')).toBe(true);
    expect(closure.has('com.example/user-device@v1')).toBe(true);
    expect(closure.has('location-record')).toBe(true);
  });

  it('proves static feasibility against closure and identifies missing assertion types', () => {
    const closure = engine.computeFrontierClosure([bundle]);

    const resultFeasible = engine.proveStaticFeasibility(['com.example/user-location@v1'], closure);
    expect(resultFeasible.isFeasible).toBe(true);
    expect(resultFeasible.missingAssertionTypes.length).toBe(0);

    const resultInfeasible = engine.proveStaticFeasibility(['com.example/credit-score@v1'], closure);
    expect(resultInfeasible.isFeasible).toBe(false);
    expect(resultInfeasible.missingAssertionTypes).toContain('com.example/credit-score@v1');
  });
});
