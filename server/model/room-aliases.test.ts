import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomAliases } from './room-aliases';

const ASSETS = String.raw`C:\Users\x\.expediente\assets`;
const DASH = String.raw`C:\repos\dash`;

describe('RoomAliases', () => {
  it('padrão, apelido por pasta (barras e maiúsculas tanto faz), vazio volta ao padrão e persiste', () => {
    const dir = mkdtempSync(join(tmpdir(), 'expediente-rooms-'));
    try {
      const file = join(dir, 'rooms.json');
      const a = new RoomAliases(file);
      a.setDefault(ASSETS, 'Arquiteto');
      expect(a.get('c:/users/x/.expediente/assets/')).toBe('Arquiteto');
      expect(a.set(DASH, '  Painel   do  Dash ')).toBe('Painel do Dash');
      expect(a.set(ASSETS, 'Oficina')).toBe('Oficina');
      const b = new RoomAliases(file);
      b.load();
      expect(b.get('c:/repos/dash')).toBe('Painel do Dash');
      b.setDefault(ASSETS, 'Arquiteto');
      expect(b.set(ASSETS, '')).toBe('Arquiteto');
      expect(b.get('/outro')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tira controle e marcas de direção do texto do nome, ao gravar e ao carregar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'expediente-rooms-'));
    try {
      const file = join(dir, 'rooms.json');
      const a = new RoomAliases(file);
      expect(a.set(DASH, 'Sala‮odnum\u0007⁦x‏')).toBe('Salaodnumx');
      writeFileSync(file, JSON.stringify({ version: 1, aliases: { [DASH]: 'Co‭mum\u0000' } }));
      const b = new RoomAliases(file);
      b.load();
      expect(b.get(DASH)).toBe('Comum');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
