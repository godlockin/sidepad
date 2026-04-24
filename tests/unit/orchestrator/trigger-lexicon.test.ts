import { describe, it, expect } from 'vitest';
import { scanLead, scanComment } from '../../../src/main/orchestrator/trigger-lexicon';

describe('trigger-lexicon', () => {
  it('matches Chinese lead verbs', () => {
    expect(scanLead('你来主答这个问题')).toBe(true);
    expect(scanLead('你先回答')).toBe(true);
    expect(scanLead('带头回答')).toBe(true);
    expect(scanLead('主导这次讨论')).toBe(true);
  });
  it('matches English lead verbs', () => {
    expect(scanLead('you lead the discussion')).toBe(true);
    expect(scanLead('you go first')).toBe(true);
    expect(scanLead('you answer first')).toBe(true);
  });
  it('does not match neutral text', () => {
    expect(scanLead('what is 2+2?')).toBe(false);
    expect(scanLead('tell me a joke')).toBe(false);
  });
  it('matches comment verbs', () => {
    expect(scanComment('你来点评一下')).toBe(true);
    expect(scanComment('补充一些内容')).toBe(true);
    expect(scanComment('follow up on that')).toBe(true);
  });
});
