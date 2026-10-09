import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BOTTOM_STYLES, FACIAL_HAIR, HAIR_STYLES, PART_KEYS, TOP_STYLES } from '../../../shared/appearance';
import { appearanceFromSeed } from '../art/character/appearance';
import { canEditCharacter, changedParts, EDITOR_GROUPS, rowVisible, styleLabel } from './character-model';

const OPEN = { live: true, terminal: true, local: true, replaying: false, mock: false };
const MAIN = { id: '.claude:1', kind: 'main' } as const;

describe('canEditCharacter', () => {
  it('só o principal real, ao vivo, com acesso local (fora do timelapse e do mock)', () => {
    expect(canEditCharacter(MAIN, OPEN)).toBe(true);
    expect(canEditCharacter({ id: 's:sub', kind: 'sub' }, OPEN)).toBe(false);
    expect(canEditCharacter({ id: 'demo:x-1', kind: 'main' }, OPEN)).toBe(false);
    for (const k of ['live', 'terminal', 'local'] as const) expect(canEditCharacter(MAIN, { ...OPEN, [k]: false })).toBe(false);
    for (const k of ['replaying', 'mock'] as const) expect(canEditCharacter(MAIN, { ...OPEN, [k]: true })).toBe(false);
  });
});

describe('changedParts', () => {
  it('só as peças diferentes da aparência da seed, na ordem fixa', () => {
    const base = appearanceFromSeed(3, { look: 'm' });
    const skin = base.skin === '#5a3623' ? '#ffe2cc' : '#5a3623';
    const topStyle = base.topStyle === 'jacket' ? 'polo' : 'jacket';
    const parts = changedParts(base, { ...base, topStyle, skin });
    expect(parts).toEqual({ skin, topStyle });
    expect(Object.keys(parts)).toEqual(['skin', 'topStyle']);
    expect(changedParts(base, { ...base })).toEqual({});
  });
});

describe('grupos e rótulos do editor', () => {
  it('todas as peças aparecem uma vez no editor', () => {
    const keys = EDITOR_GROUPS.flatMap((g) => g.rows.map((r) => r.key));
    expect([...keys].sort()).toEqual([...PART_KEYS].sort());
  });

  it('todo estilo tem rótulo em português', () => {
    const lists = { hairStyle: HAIR_STYLES, topStyle: TOP_STYLES, bottomStyle: BOTTOM_STYLES, accessory: ACCESSORIES, facialHair: FACIAL_HAIR } as const;
    for (const [key, values] of Object.entries(lists)) {
      for (const v of values) expect(styleLabel(key as keyof typeof lists, v), `${key}=${v}`).not.toBe(v);
    }
  });

  it('a cor do acessório some quando não há acessório', () => {
    const color = EDITOR_GROUPS.flatMap((g) => g.rows).find((r) => r.key === 'accessoryColor')!;
    expect(rowVisible(color, { accessory: 'none' })).toBe(false);
    expect(rowVisible(color, { accessory: 'cap' })).toBe(true);
  });
});
