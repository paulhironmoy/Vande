import { beforeEach, describe, expect, it } from 'vitest';
import { wipeLiteLocalData } from '@/lite/localData';
import { awardChallenger, readLedger, writeLedger } from '@/lite/ledger';
import { ensureAttempt, readAttempt } from '@/lite/twists';
import { useApp } from '@/app/store';

describe('Lite local data and "Delete all local data"', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('removes every vande:lite-* key and leaves other keys alone', () => {
    localStorage.setItem('vande:lite-best', '1200');
    localStorage.setItem('vande:lite-best-insight', '300');
    localStorage.setItem('vande:lite-helper', '{"answers":1,"best":0,"points":40,"seen":[]}');
    writeLedger(awardChallenger(readLedger(), 'k1', true).ledger);
    ensureAttempt('k1');
    sessionStorage.setItem('vande:lite-run', '{}');
    localStorage.setItem('vande:other', 'keep');
    wipeLiteLocalData();
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.key(i)?.startsWith('vande:lite-')).toBe(false);
    expect(sessionStorage.getItem('vande:lite-run')).toBeNull();
    expect(localStorage.getItem('vande:other')).toBe('keep');
    expect(readLedger().challenger.points).toBe(0);
    expect(readAttempt('k1')).toBeUndefined();
  });

  it('runs as part of the store-wide delete', async () => {
    localStorage.setItem('vande:lite-best', '999');
    sessionStorage.setItem('vande:lite-run', '{}');
    await useApp.getState().deleteAllData();
    expect(localStorage.getItem('vande:lite-best')).toBeNull();
    expect(sessionStorage.getItem('vande:lite-run')).toBeNull();
  });
});
