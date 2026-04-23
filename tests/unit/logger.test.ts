import { describe, it, expect } from 'vitest';
import { log } from '../../src/main/logger';

describe('logger', () => {
  it('exposes pino-like API', () => {
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });
  it('logs without throwing', () => {
    expect(() => log.info({ smoke: true }, 'logger smoke')).not.toThrow();
  });
});
