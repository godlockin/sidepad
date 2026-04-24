import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secretRouter } from '../../../src/main/ipc/routers/secret-router';

describe('secretRouter', () => {
  beforeEach(() => {
    (globalThis as any).sidepad = {
      secrets: { has: vi.fn(() => false), set: vi.fn(), delete: vi.fn() },
    };
  });

  afterEach(() => {
    delete (globalThis as any).sidepad;
  });

  it('has exactly 3 procedures: has, set, delete', () => {
    const proc = (secretRouter as any)._def.procedures;
    expect(Object.keys(proc).sort()).toEqual(['delete', 'has', 'set']);
  });

  it('does not expose a get procedure', () => {
    const proc = (secretRouter as any)._def.procedures;
    expect(proc.get).toBeUndefined();
  });

  it('has procedure types are queries/mutations', () => {
    const proc = (secretRouter as any)._def.procedures;
    // has is a query (read-only)
    expect(proc.has._def.query).toBeDefined();
    // set and delete are mutations
    expect(proc.set._def.mutation).toBeDefined();
    expect(proc.delete._def.mutation).toBeDefined();
  });
});
