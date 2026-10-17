import { describe, it, expect } from 'vitest';
import { matchPermissionPrompt, PermissionSniffer } from '@main/pty/sniffer';

describe('matchPermissionPrompt', () => {
  it('matches allow y/n', () => {
    const hit = matchPermissionPrompt('Allow Edit foo.ts? (y/n)');
    expect(hit?.kind).toBe('allow_yn');
  });

  it('matches numbered choice', () => {
    const hit = matchPermissionPrompt('1. Yes\n2. No\n');
    expect(hit?.kind).toBe('numbered_choice');
  });

  it('returns null for ordinary output', () => {
    expect(matchPermissionPrompt('git status\non branch main')).toBeNull();
  });
});

describe('PermissionSniffer', () => {
  it('dedups identical hits within the window', () => {
    const s = new PermissionSniffer();
    const first = s.feed('Allow Edit a.ts? (y/n)');
    expect(first?.kind).toBe('allow_yn');
    const second = s.feed('Allow Edit a.ts? (y/n)');
    expect(second).toBeNull();
  });
});
