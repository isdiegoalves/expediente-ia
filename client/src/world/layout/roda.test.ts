// Lugar da roda da equipe: um canto livre de verdade em toda variação de sala.
import { describe, expect, it } from 'vitest';
import { FURNITURE, type RoomTheme } from '../../art/api';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { RODA_H, RODA_W, lugarDaRoda, tileDaRoda } from './roda';
import { layoutProjectRoom } from './room';
import type { AreaLayout, SpotDef, SpotKind } from './types';

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

  it('desvia de lugar marcado e da passagem da porta mesmo quando o melhor canto cai neles', () => {
    const spot = (kind: SpotKind, tx: number, ty: number): SpotDef => ({ id: `${kind}${tx},${ty}`, kind, areaId: 'r', tx, ty, x: tx * 16 + 8, y: ty * 16 + 11, dir: 'up' });
    const sala = (spots: SpotDef[]): AreaLayout => ({
      id: 'r',
      kind: 'room',
      rect: { x: 0, y: 0, w: 16, h: 12 },
      floors: [],
      rugs: [],
      walls: [],
      wallItems: [],
      furniture: [],
      spots,
      walkable: [{ x: 1, y: 2, w: 14, h: 9 }],
      door: { x: 7, y: 11, w: 2, h: 1 },
    });
    // a ilha em x = 4: o melhor bloco seria 3..5 na linha 8, onde há um ponto em pé
    const comPonto = lugarDaRoda(sala([spot('desk', 4, 4), spot('stand', 4, 8)]));
    expect(comPonto.tx > 4 || comPonto.tx + RODA_W <= 4 || comPonto.ty > 8 || comPonto.ty + RODA_H <= 8).toBe(true);
    // a ilha em x = 8: o melhor bloco seria 7..9, colado na porta
    const pertoDaPorta = lugarDaRoda(sala([spot('desk', 8, 4)]));
    for (let y = pertoDaPorta.ty; y < pertoDaPorta.ty + RODA_H; y++) for (let x = pertoDaPorta.tx; x < pertoDaPorta.tx + RODA_W; x++) expect(Math.abs(x - 7.5) <= 2 && Math.abs(y - 11) <= 2.5).toBe(false);
  });
});
