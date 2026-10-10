import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import type { VersaoView } from '../../../shared/versao';
import { sobreModelo, versaoNova, versaoParaAvisar, versionInfo } from './version';

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

const ULTIMA = { versao: '1.1.0', publicadaEm: '2026-10-01T12:00:00Z', url: 'https://github.com/isdiegoalves/expediente-ia/releases/tag/v1.1.0' };
const NOVA: VersaoView = { emUso: '1.0.0', nova: true, verificadoEm: '2026-10-10T09:00:00Z', ultima: ULTIMA };
const AGORA = Date.parse('2026-10-10T12:00:00Z');

describe('versaoNova e versaoParaAvisar', () => {
  it('selo e aviso só com versão maior', () => {
    expect(versaoNova(NOVA)).toEqual(ULTIMA);
    expect(versaoNova({ ...NOVA, nova: false })).toBeNull();
    expect(versaoNova({ emUso: '1.0.0', nova: false })).toBeNull();
    expect(versaoNova(null)).toBeNull();
    expect(versaoParaAvisar({ ...NOVA, nova: false }, null)).toBeNull();
  });

  it('avisa uma vez por versão nova', () => {
    expect(versaoParaAvisar(NOVA, null)).toBe('1.1.0');
    expect(versaoParaAvisar(NOVA, '1.1.0')).toBeNull();
    expect(versaoParaAvisar({ ...NOVA, ultima: { ...ULTIMA, versao: '1.2.0' } }, '1.1.0')).toBe('1.2.0');
  });
});

describe('sobreModelo', () => {
  it('com versão nova: data, link e há quanto tempo foi a verificação', () => {
    const m = sobreModelo(NOVA, AGORA);
    expect(m.nova).toEqual({ versao: '1.1.0', quando: new Date(ULTIMA.publicadaEm).toLocaleDateString('pt-BR'), url: ULTIMA.url });
    expect(m.verificacao).toEqual({ texto: 'Última verificação: há 3 h' });
    expect(m.origem).toBeNull();
  });

  it('sem verificação nenhuma: nunca verificado, com o comando', () => {
    const m = sobreModelo({ emUso: '1.0.0', nova: false }, AGORA);
    expect(m.nova).toBeNull();
    expect(m.verificacao).toEqual({ texto: 'Nunca verificado: rode', comando: 'npm run versao' });
    expect(sobreModelo(null, AGORA).verificacao.comando).toBe('npm run versao');
  });

  it('origem só aparece quando vem, com a análise se houver', () => {
    const origem = { nome: 'Projeto X', ultima: '0.9.0', publicadaEm: '2026-10-01T12:00:00Z', url: 'https://example.com/r' };
    expect(sobreModelo({ ...NOVA, origem }, AGORA).origem).toEqual({ texto: 'Novidade no projeto de origem: Projeto X 0.9.0', analise: undefined });
    expect(sobreModelo({ ...NOVA, origem: { ...origem, analise: 'https://example.com/a' } }, AGORA).origem?.analise).toBe('https://example.com/a');
  });
});
