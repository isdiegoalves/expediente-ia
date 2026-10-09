import { describe, expect, it } from 'vitest';
import { avisoProcesso, AVISO_PROCESSO_NAO_CONFIRMADO, linhasParado, textoEspera } from './parado';

const MIN = 60_000;

describe('textoEspera', () => {
  it('diz há quanto tempo espera e o motivo', () => {
    expect(textoEspera({ statusSince: 0, waitingFor: 'aprovar uma permissão' }, 10 * MIN)).toBe('Esperando há 10 min: aprovar uma permissão');
  });
  it('sem motivo e recém-chegado', () => {
    expect(textoEspera({ statusSince: 1_000 }, 2_000)).toBe('Esperando agora');
  });
});

describe('linhasParado', () => {
  it('mostra tempo, ferramenta pendente, último erro e tentativas', () => {
    const l = linhasParado({ desde: 0, pendente: 'Bash', erro: 'Servidor sobrecarregado (529)', tentativa: 3, maxTentativas: 10 }, 5 * MIN);
    expect(l).toEqual([
      'Sem escrever há 5 min, sem fechamento.',
      'Esperando a ferramenta Bash responder.',
      'Último erro da API: Servidor sobrecarregado (529) (tentativa 3 de 10)',
    ]);
  });
  it('só o tempo quando não há pendência nem erro', () => {
    expect(linhasParado({ desde: 0 }, 2 * MIN)).toEqual(['Sem escrever há 2 min, sem fechamento.']);
  });
});

describe('avisoProcesso', () => {
  const src = (processoConfirmado?: boolean) => [{ label: '.claude', path: '/x', sessions: 1, ok: true, processoConfirmado }];
  it('avisa no agente principal de fonte sem conferência de PID', () => {
    expect(avisoProcesso({ kind: 'main', account: '.claude' }, src(false))).toBe(AVISO_PROCESSO_NAO_CONFIRMADO);
  });
  it('não avisa quando o PID é conferido, no subagente ou sem a informação', () => {
    expect(avisoProcesso({ kind: 'main', account: '.claude' }, src(true))).toBeUndefined();
    expect(avisoProcesso({ kind: 'sub', account: '.claude' }, src(false))).toBeUndefined();
    expect(avisoProcesso({ kind: 'main', account: '.claude' }, src(undefined))).toBeUndefined();
  });
});
