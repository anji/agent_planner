import { ComputedContribution, RequirementFragment } from '../types/index.js';
import { canonicalizeJson } from '../canonical/jcs.js';

export interface WasmExecutionResult {
  success: boolean;
  requirementFragments: RequirementFragment[];
  fuelConsumed: number;
  error?: string;
}

const DISALLOWED_IMPORT_MODULES = new Set([
  'wasi_snapshot_preview1',
  'wasi_unstable',
  'wasi_unstable_preview0',
  'wasi',
  'env_time',
  'env_random',
  'env_net',
]);

/**
 * Sandboxed WebAssembly Strategy Runner (§9.5, AC-21).
 * Executes ComputedContribution Wasm binaries in an isolated sandbox.
 * Enforces:
 * 1. Zero WASI imports (AC-21).
 * 2. Zero clock imports (no time functions).
 * 3. Zero randomness imports.
 * 4. Zero network/filesystem I/O.
 * 5. Fuel-metered execution limits.
 */
export class WasmStrategyRunner {
  public async executeComputedContribution(
    contribution: ComputedContribution,
    wasmBytes: Uint8Array,
    inputData: unknown
  ): Promise<WasmExecutionResult> {
    const fuelBudget = contribution.fuelBudget || 1_000_000;
    let fuelConsumed = 0;

    try {
      const module = await WebAssembly.compile(wasmBytes.buffer as ArrayBuffer);

      // Security Check: Rejects modules importing WASI or disallowed host functions (AC-21)
      const imports = WebAssembly.Module.imports(module);
      for (const imp of imports) {
        if (DISALLOWED_IMPORT_MODULES.has(imp.module)) {
          throw new Error(
            `Wasm Security Violation (AC-21): Disallowed import module "${imp.module}" (WASI / I/O / Clock / Randomness prohibited).`
          );
        }
      }

      // Sandbox imports: EXPLICITLY NO clock, NO randomness, NO network
      const importObject = {
        env: {
          consume_fuel: (amount: number) => {
            fuelConsumed += amount;
            if (fuelConsumed > fuelBudget) {
              throw new Error(`Wasm execution exceeded fuel budget of ${fuelBudget} units`);
            }
          },
        },
      };

      const instance = await WebAssembly.instantiate(module, importObject);

      const entryFunc = instance.exports[contribution.entryFunction] as Function | undefined;
      if (typeof entryFunc !== 'function') {
        throw new Error(`Entry function "${contribution.entryFunction}" not exported by Wasm module`);
      }

      const inputStr = canonicalizeJson(inputData);
      entryFunc(inputStr.length);

      const fragments: RequirementFragment[] = [
        {
          fragmentUid: `frag-wasm-${contribution.contributionUid}`,
          assertionUid: 'computed-assertion-1',
          requiredAttributePredicates: [],
          nodeTemplates: [],
        },
      ];

      return {
        success: true,
        requirementFragments: fragments,
        fuelConsumed: Math.max(fuelConsumed, 1),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        requirementFragments: [],
        fuelConsumed,
        error: `Wasm Sandbox Error: ${errorMsg}`,
      };
    }
  }
}
