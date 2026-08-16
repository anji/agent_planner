import { describe, expect, it } from 'vitest';
import { SchemaRegistry } from '../../src/registry/attribute-registry.js';
import { evaluatePredicate } from '../../src/predicate/evaluator.js';
import { evaluateCondition } from '../../src/predicate/condition-evaluator.js';
import { AttributeDefinition, AssertionTypeDefinition, Predicate, TypedValue, Binding } from '../../src/types/index.js';

describe('Schema Registry & Deprecation Ladders', () => {
  it('resolves active types directly', () => {
    const registry = new SchemaRegistry();
    const typeDef: AssertionTypeDefinition = {
      name: 'com.example/check@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'sha256:123' },
      outputRoles: {},
    };
    registry.registerAssertionType(typeDef);

    const res = registry.resolveAssertionType('com.example/check@v1');
    expect(res.resolvedType).toBe('com.example/check@v1');
    expect(res.status).toBe('ACTIVE');
    expect(res.hops).toBe(0);
  });

  it('transitively resolves deprecated assertion types', () => {
    const registry = new SchemaRegistry();
    registry.registerAssertionType({
      name: 'com.example/old@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'sha256:1' },
      outputRoles: {},
      deprecation: { status: 'DEPRECATED', replacementType: 'com.example/mid@v1' },
    });
    registry.registerAssertionType({
      name: 'com.example/mid@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'sha256:2' },
      outputRoles: {},
      deprecation: { status: 'SUNSET', replacementType: 'com.example/new@v1' },
    });
    registry.registerAssertionType({
      name: 'com.example/new@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'sha256:3' },
      outputRoles: {},
    });

    const res = registry.resolveAssertionType('com.example/old@v1');
    expect(res.resolvedType).toBe('com.example/new@v1');
    expect(res.hops).toBe(2);
    expect(res.diagnostics.length).toBe(2);
  });

  it('rejects WITHDRAWN assertion types', () => {
    const registry = new SchemaRegistry();
    registry.registerAssertionType({
      name: 'com.example/legacy@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'sha256:1' },
      outputRoles: {},
      deprecation: { status: 'WITHDRAWN', replacementType: 'com.example/v2@v1' },
    });

    expect(() => registry.resolveAssertionType('com.example/legacy@v1')).toThrow(
      /WITHDRAWN/
    );
  });
});

describe('3-Valued Kleene Logic Predicate Evaluator', () => {
  it('returns UNKNOWN for absent attributes (never coerced to FALSE)', () => {
    const pred: Predicate = {
      op: 'EQ',
      attribute: 'com.example/tier@v1',
      value: { type: 'core/string', value: 'GOLD' },
    };

    const res = evaluatePredicate(pred, {});
    expect(res).toBe('UNKNOWN');
  });

  it('evaluates PRESENT and ABSENT operators correctly', () => {
    const attrName = 'com.example/flag@v1';
    const attributes: Record<string, TypedValue> = {
      [attrName]: { type: 'core/bool', value: true },
    };

    expect(evaluatePredicate({ op: 'PRESENT', attribute: attrName }, attributes)).toBe('TRUE');
    expect(evaluatePredicate({ op: 'ABSENT', attribute: attrName }, attributes)).toBe('FALSE');
    expect(evaluatePredicate({ op: 'PRESENT', attribute: 'missing' }, attributes)).toBe('FALSE');
    expect(evaluatePredicate({ op: 'ABSENT', attribute: 'missing' }, attributes)).toBe('TRUE');
  });

  it('evaluates SUPERSET_OF and INTERSECTS set predicates', () => {
    const attrName = 'com.example/tags@v1';
    const attributes: Record<string, TypedValue> = {
      [attrName]: { type: 'core/set', value: ['US', 'EU', 'JP'] },
    };

    const supersetPred: Predicate = {
      op: 'SUPERSET_OF',
      attribute: attrName,
      values: [{ type: 'core/string', value: 'US' }, { type: 'core/string', value: 'EU' }],
    };
    expect(evaluatePredicate(supersetPred, attributes)).toBe('TRUE');

    const intersectsPred: Predicate = {
      op: 'INTERSECTS',
      attribute: attrName,
      values: [{ type: 'core/string', value: 'CA' }, { type: 'core/string', value: 'EU' }],
    };
    expect(evaluatePredicate(intersectsPred, attributes)).toBe('TRUE');
  });
});

describe('Condition Evaluator Truth Tables', () => {
  const dummyBinding: Binding = { source: 'GOAL', path: '/a', expectedType: { digest: 'd' } };

  it('evaluates ALL truth table (FALSE if any FALSE, UNKNOWN if any UNKNOWN)', () => {
    const resolveTrue = () => ({ type: 'core/bool', value: true });
    const resolveUnbound = () => undefined;

    expect(evaluateCondition({ all: [{ defined: dummyBinding }] }, resolveTrue)).toBe('TRUE');
    expect(evaluateCondition({ all: [{ defined: dummyBinding }] }, resolveUnbound)).toBe('FALSE');
    expect(evaluateCondition({
      all: [
        { defined: dummyBinding },
        { compare: { op: 'EQ', left: dummyBinding, right: { type: 'core/string', value: 'x' } } }
      ]
    }, resolveUnbound)).toBe('FALSE');
  });

  it('evaluates NOT truth table (NOT UNKNOWN => UNKNOWN)', () => {
    const resolveUnbound = () => undefined;

    const notUnknown = evaluateCondition({
      not: { compare: { op: 'EQ', left: dummyBinding, right: { type: 'core/string', value: 'x' } } }
    }, resolveUnbound);

    expect(notUnknown).toBe('UNKNOWN');
  });
});
