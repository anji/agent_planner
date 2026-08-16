import { describe, expect, it } from 'vitest';
import { FederatedRegistry } from '../../src/registry/federated-registry.js';
import { SchemaRegistry } from '../../src/registry/attribute-registry.js';

describe('Federated Schema Registry', () => {
  it('searches child registries and resolves assertion types across tenant boundaries', () => {
    const fed = new FederatedRegistry();

    const childReg = new SchemaRegistry();
    childReg.registerAssertionType({
      name: 'com.partner/check@v1',
      owner: 'partner-corp',
      subjectSchema: { digest: 'd' },
      outputRoles: {},
    });

    fed.registerChildRegistry('partner-registry', childReg);

    const res = fed.findAssertionType('com.partner/check@v1');
    expect(res).toBeDefined();
    expect(res?.sourceRegistryId).toBe('partner-registry');
    expect(res?.definition.owner).toBe('partner-corp');
  });
});
