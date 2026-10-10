// Lugar da roda da equipe numa sala de projeto: o canto livre onde ficam os subagentes que não cabem como
// personagens individuais. Puro (só o layout da sala).
import { FURNITURE, TILE } from '../../art/api';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { inRect } from './geometry';
import type { AreaLayout } from './types';

/** A roda ocupa um bloco de 3x2 tiles. */
export const RODA_W = 3;
export const RODA_H = 2;

export interface LugarDaRoda {
  /** Canto superior esquerdo do bloco (tiles absolutos). */
  tx: number;
  ty: number;
  /** Centro do bloco (px de mundo): os pés da roda se espalham em volta. */
  x: number;
  y: number;
}

const cache = new WeakMap<AreaLayout, LugarDaRoda>();

/**
 * Bloco livre da sala (sem móvel, assento ou lugar marcado e longe da porta), de preferência na faixa de baixo,
 * logo abaixo da ilha de mesas, onde a equipe parece reunida perto de quem trabalha.
 */
export function lugarDaRoda(layout: AreaLayout): LugarDaRoda {
  const hit = cache.get(layout);
  if (hit) return hit;
  const r = layout.rect;
  const livre = new Uint8Array(r.w * r.h);
  const marca = (x: number, y: number, v: number) => {
    if (inRect(r, x, y)) livre[(y - r.y) * r.w + (x - r.x)] = v;
  };
  for (const w of layout.walkable) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) marca(x, y, 1);
  for (const b of layout.blocked ?? []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) marca(x, y, 0);
  for (const f of layout.furniture) {
    if (!furnitureBlocks(f.kind) && !furnitureIsSeat(f.kind)) continue;
    const { w, h } = FURNITURE[f.kind].footprint;
    for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) marca(x, y, 0);
  }
  for (const s of layout.spots) marca(s.tx, s.ty, 0);
  const ok = (x: number, y: number) => inRect(r, x, y) && livre[(y - r.y) * r.w + (x - r.x)] === 1;

  const door = layout.door;
  const pertoDaPorta = (x: number, y: number) =>
    !!door && Math.abs(x - (door.x + door.w / 2 - 0.5)) <= 2 && Math.abs(y - (door.y + door.h / 2 - 0.5)) <= 2.5;
  const mesas = layout.spots.filter((s) => s.kind === 'desk');
  const ilhaX = mesas.length ? mesas.reduce((n, s) => n + s.tx, 0) / mesas.length : r.x + r.w / 2;

  let melhor: LugarDaRoda | null = null;
  let melhorNota = -Infinity;
  for (let ty = r.y + 2; ty + RODA_H <= r.y + r.h - 1; ty++) {
    for (let tx = r.x + 1; tx + RODA_W <= r.x + r.w - 1; tx++) {
      let cabe = true;
      for (let y = ty; y < ty + RODA_H && cabe; y++) for (let x = tx; x < tx + RODA_W && cabe; x++) if (!ok(x, y) || pertoDaPorta(x, y)) cabe = false;
      if (!cabe) continue;
      const cx = tx + RODA_W / 2 - 0.5;
      const nota = -Math.abs(ty - (r.y + 8)) * 2 - Math.abs(cx - ilhaX) * 0.5;
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = { tx, ty, x: (tx + RODA_W / 2) * TILE, y: (ty + RODA_H / 2) * TILE + 6 };
      }
    }
  }
  const lugar = melhor ?? { tx: r.x + 6, ty: r.y + 8, x: (r.x + 7.5) * TILE, y: (r.y + 9) * TILE + 6 };
  cache.set(layout, lugar);
  return lugar;
}

/** Tile do meio da roda: para onde anda quem entra nela. */
export function tileDaRoda(l: LugarDaRoda): { x: number; y: number } {
  return { x: l.tx + 1, y: l.ty + 1 };
}
