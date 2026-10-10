// Lugar da roda da equipe: um canto livre de verdade em toda variação de sala.
import { describe, expect, it } from 'vitest';
import { FURNITURE, type RoomTheme } from '../../art/api';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { RODA_H, RODA_W, lugarDaRoda, tileDaRoda } from './roda';
import { layoutProjectRoom } from './room';

const theme: RoomTheme = { carpet: '#4f6d8f', carpet2: '#486685', wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black' };

describe('lugar da roda', () => {
  it('em 600 salas (norte e sul, espelhadas ou não), o bloco fica no piso livre, sem móvel, assento, lugar marcado nem porta', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const slot of [4, 5]) {
        const a = layoutProjectRoom({ id: `/p/${seed}`, slot, seed }, theme);
        const l = lugarDaRoda(a);
        const r = a.rect;
        const anda = (x: number, y: number) => a.walkable.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
        for (let y = l.ty; y < l.ty + RODA_H; y++) {
          for (let x = l.tx; x < l.tx + RODA_W; x++) {
            expect(x > r.x && x < r.x + r.w - 1 && y >= r.y + 2 && y < r.y + r.h - 1).toBe(true);
            expect(anda(x, y)).toBe(true);
            expect(a.spots.some((s) => s.tx === x && s.ty === y)).toBe(false);
            const movel = a.furniture.find((f) => {
              const { w, h } = FURNITURE[f.kind].footprint;
              return (furnitureBlocks(f.kind) || furnitureIsSeat(f.kind)) && x >= f.tx && x < f.tx + w && y >= f.ty && y < f.ty + h;
            });
            expect(movel).toBeUndefined();
            const d = a.door!;
            expect(Math.abs(x - (d.x + d.w / 2 - 0.5)) <= 2 && Math.abs(y - (d.y + d.h / 2 - 0.5)) <= 2.5).toBe(false);
          }
        }
        expect(tileDaRoda(l)).toEqual({ x: l.tx + 1, y: l.ty + 1 });
      }
    }
  });

  it('fica embaixo da ilha de mesas e é o mesmo enquanto o layout não muda', () => {
    const a = layoutProjectRoom({ id: '/p', slot: 4, seed: 12 }, theme);
    const l = lugarDaRoda(a);
    expect(l.ty - a.rect.y).toBe(8);
    expect(lugarDaRoda(a)).toBe(l);
  });
});
