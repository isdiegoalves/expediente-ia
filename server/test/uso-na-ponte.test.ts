import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
// @ts-expect-error o tap é .mjs sem tipos
import { usageDirOf as tapUsageDir } from '../../scripts/statusline-tap.mjs';
import { tempDir } from './fixtures';

describe('uso ao vivo grava na pasta da ponte', () => {
  it('o servidor e o tap usam ~/.expediente/host/uso por padrão', () => {
    const tmp = tempDir();
    try {
      const esperado = join(tmp.dir, '.expediente', 'host', 'uso');
      expect(loadConfig({ HOME: tmp.dir }, [], false).usageDir).toBe(esperado);
      expect(tapUsageDir({ HOME: tmp.dir }, tmp.dir)).toBe(esperado);
    } finally {
      tmp.cleanup();
    }
  });

  it('EXPEDIENTE_USAGE_DIR continua mandando', () => {
    const tmp = tempDir();
    try {
      const outro = join(tmp.dir, 'outro');
      expect(loadConfig({ HOME: tmp.dir, EXPEDIENTE_USAGE_DIR: outro }, [], false).usageDir).toBe(outro);
      expect(tapUsageDir({ HOME: tmp.dir, EXPEDIENTE_USAGE_DIR: outro }, tmp.dir)).toBe(outro);
    } finally {
      tmp.cleanup();
    }
  });
});
