import { describe, expect, it } from 'vitest';
import type { RoomInfo } from '../../shared/types';
import { salaPedida, salaPelaOrdem } from './enquadrar';

const sala = (id: string, slot: number): RoomInfo => ({ id, name: id, path: `/p/${id}`, slot, seed: 1, createdAt: 0 });

describe('?sala=<n>', () => {
  it('lê um inteiro de 1 a 20; o resto não pede enquadramento', () => {
    expect(salaPedida('?mock=1&sala=2')).toBe(2);
    expect(salaPedida('?sala=20')).toBe(20);
    for (const q of ['', '?mock=1', '?sala=', '?sala=0', '?sala=-1', '?sala=21', '?sala=1.5', '?sala=abc', '?sala=2x', '?sala=Infinity']) expect(salaPedida(q), q).toBeNull();
  });

  it('a n-ésima sala é a da n-ésima vaga, e a lista recebida não muda', () => {
    const lista = [sala('c', 4), sala('a', 0), sala('b', 2)];
    expect(salaPelaOrdem(lista, 1)?.id).toBe('a');
    expect(salaPelaOrdem(lista, 2)?.id).toBe('b');
    expect(salaPelaOrdem(lista, 3)?.id).toBe('c');
    expect(lista.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('sala que ainda não existe é undefined (a página espera o próximo snapshot)', () => {
    expect(salaPelaOrdem([sala('a', 0)], 2)).toBeUndefined();
    expect(salaPelaOrdem([], 1)).toBeUndefined();
  });
});
