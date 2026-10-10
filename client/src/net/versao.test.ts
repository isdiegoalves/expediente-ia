import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersaoView } from '../../../shared/versao';
import { buscarVersaoHttp, mockVersao, VersaoFeed } from './versao';

const VIEW: VersaoView = { emUso: '1.0.0', nova: false };

describe('VersaoFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('avisa quando muda, não quando repete, e mantém o que havia se a busca falha', async () => {
    const respostas: Array<VersaoView | null> = [VIEW, VIEW, null, { ...VIEW, nova: true }];
    const feed = new VersaoFeed(async () => respostas.shift() ?? null, 1000);
    const mudou = vi.fn();
    feed.onChange(mudou);
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.view).toEqual(VIEW);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mudou).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.view).toEqual(VIEW);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.view?.nova).toBe(true);
    expect(mudou).toHaveBeenCalledTimes(2);
    feed.stop();
  });
});

describe('buscarVersaoHttp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devolve null em erro de rede, status ruim e corpo fora do formato', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('x');
    });
    expect(await buscarVersaoHttp()).toBeNull();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    expect(await buscarVersaoHttp()).toBeNull();
    vi.stubGlobal('fetch', async () => new Response('{"emUso": 1}'));
    expect(await buscarVersaoHttp()).toBeNull();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(VIEW)));
    expect(await buscarVersaoHttp()).toEqual(VIEW);
  });
});

describe('mockVersao', () => {
  const agora = Date.parse('2026-10-10T12:00:00Z');
  it('cada cenário do ?versao=', () => {
    expect(mockVersao(null, agora)).toBeNull();
    expect(mockVersao('qualquer', agora)).toBeNull();
    expect(mockVersao('nunca', agora)).toEqual({ emUso: '1.0.0', nova: false });
    expect(mockVersao('atual', agora)?.nova).toBe(false);
    expect(mockVersao('nova', agora)).toMatchObject({ nova: true, ultima: { versao: '1.1.0' } });
    expect(mockVersao('nova', agora)?.origem).toBeUndefined();
    expect(mockVersao('origem', agora)?.origem?.nome).toBeTruthy();
  });
});
