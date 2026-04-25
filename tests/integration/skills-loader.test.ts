import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openSidepadDb } from '@main/store/db';
import { createSkillStore } from '@main/store/skill-store';
import {
  loadSkillsFromDisk,
  writeUserSkill,
  deleteUserSkill,
} from '@main/skills/loader';

let tmpDir: string;
let userDir: string;
let bundledDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-skills-'));
  userDir = path.join(tmpDir, 'user-skills');
  bundledDir = path.resolve('tests/fixtures/skills');
  dbPath = path.join(tmpDir, 'sidepad.db');
  fs.mkdirSync(userDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('skills loader', () => {
  it('loads bundled skill from markdown with frontmatter', () => {
    const records = loadSkillsFromDisk({ bundledDir, userDir });
    expect(records.length).toBeGreaterThanOrEqual(1);
    const r = records.find((s) => s.id === 'bundled:researcher');
    expect(r).toBeDefined();
    expect(r!.name).toBe('Researcher');
    expect(r!.description).toContain('searches');
    expect(r!.manifest.system_prompt_addendum).toContain('cite URLs');
    expect(r!.manifest.recommended_tools).toEqual(['web_search', 'fetch_url']);
    expect(r!.body).toContain('# Researcher');
    expect(r!.source).toBe('bundled');
  });

  it('writes a user skill to disk and loads it back', () => {
    writeUserSkill(
      { userDir },
      'helper',
      {
        name: 'Helper',
        description: 'Always helpful',
        system_prompt_addendum: 'Be brief.',
        recommended_tools: ['echo'],
      },
      '# Helper body',
    );
    expect(fs.existsSync(path.join(userDir, 'helper.md'))).toBe(true);
    const records = loadSkillsFromDisk({ bundledDir, userDir });
    const u = records.find((s) => s.id === 'user:helper');
    expect(u).toBeDefined();
    expect(u!.source).toBe('user');
    expect(u!.manifest.system_prompt_addendum).toContain('Be brief');
  });

  it('deleteUserSkill refuses bundled ids and removes user files', () => {
    writeUserSkill({ userDir }, 'tmp', { name: 'T' }, 'x');
    expect(deleteUserSkill({ userDir }, 'bundled:researcher')).toBe(false);
    expect(deleteUserSkill({ userDir }, 'user:tmp')).toBe(true);
    expect(fs.existsSync(path.join(userDir, 'tmp.md'))).toBe(false);
  });
});

describe('skill-store DB sync', () => {
  it('syncs disk-loaded skills via upsert and preserves user-set enabled flag', () => {
    const db = openSidepadDb(dbPath);
    const store = createSkillStore(db);
    const recs = loadSkillsFromDisk({ bundledDir, userDir });
    store.syncFromDisk(recs);

    const list = store.list();
    expect(list.find((s) => s.id === 'bundled:researcher')).toBeDefined();

    // toggle enable, re-sync, ensure flag survives upsert
    store.setEnabled('bundled:researcher', true);
    store.syncFromDisk(recs);
    const after = store.get('bundled:researcher')!;
    expect(after.enabled).toBe(true);

    db.close();
  });

  it('removes stale rows whose disk file is gone', () => {
    const db = openSidepadDb(dbPath);
    const store = createSkillStore(db);

    writeUserSkill({ userDir }, 'temporary', { name: 'Temp' }, 'b');
    let recs = loadSkillsFromDisk({ bundledDir, userDir });
    store.syncFromDisk(recs);
    expect(store.get('user:temporary')).toBeDefined();

    deleteUserSkill({ userDir }, 'user:temporary');
    recs = loadSkillsFromDisk({ bundledDir, userDir });
    store.syncFromDisk(recs);
    expect(store.get('user:temporary')).toBeUndefined();

    db.close();
  });
});
