import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import { versionInfo } from './version';

function snap(version: string): OfficeSnapshot {
  return { rev: 1, serverTime: 0, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: 0, version } };
}

describe('versionInfo', () => {
  it('só versões de verdade (o ?mock=1 manda "demo" e o timelapse "timelapse")', () => {
    expect(versionInfo(snap('0.2.0'))).toEqual({ version: '0.2.0' });
    expect(versionInfo(snap('demo'))).toBeNull();
    expect(versionInfo(snap('timelapse'))).toBeNull();
    expect(versionInfo(null)).toBeNull();
  });
});
