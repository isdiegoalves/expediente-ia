// GET /api/tema (tema ativo, já validado) e GET /temas/<id>/<arquivo> (PNG e fonte declarada do tema ativo).
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { arquivoDoTema, type PastasDoTema, type TemaCarregado } from '../tema/carregar';

const ARQUIVO = /^\/temas\/([^/]+)\/(.+)$/;

type SendJson = (res: ServerResponse, status: number, body: unknown) => void;

export function createTemaHandler(pastas: PastasDoTema, ativo: TemaCarregado, sendJson: SendJson): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  return (req, res, url) => {
    const path = url.pathname;
    const isApi = path === '/api/tema';
    if (!isApi && !path.startsWith('/temas/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'método não permitido' });
      return true;
    }
    if (isApi) {
      sendJson(res, 200, { id: ativo.id, base: ativo.base, tema: ativo.tema, aviso: ativo.aviso });
      return true;
    }
    let rel: RegExpExecArray | null = null;
    try {
      rel = ARQUIVO.exec(decodeURIComponent(path));
    } catch {
      // caminho com escape inválido: cai no 404
    }
    const arquivo = rel ? arquivoDoTema(pastas, ativo, rel[1], rel[2]) : undefined;
    if (!arquivo) {
      sendJson(res, 404, { error: 'não encontrado' });
      return true;
    }
    res.writeHead(200, { 'Content-Type': arquivo.tipo, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (req.method === 'HEAD') res.end();
    else
      createReadStream(arquivo.caminho)
        .on('error', () => res.destroy())
        .pipe(res);
    return true;
  };
}
