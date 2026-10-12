// Proteções de borda do servidor HTTP (valem para a API, os estáticos e o Vite no modo dev).
//
// 1) DNS rebinding: um site malicioso pode fazer o próprio domínio resolver para 127.0.0.1 e,
//    assim, ler /api/snapshot "como se fosse a mesma origem". O navegador manda o cabeçalho Host
//    com o domínio do atacante, então só aceitamos Host que seja um IP literal, `localhost`
//    ou `expediente.localhost` (o nome do Expediente no portless); `*.localhost` em geral não, porque nem todo
//    navegador fixa esse sufixo no loopback.
// 2) CSRF: requisições que mudam estado (POST) exigem `Content-Type: application/json` — o que um
//    formulário ou um fetch "simples" de outro site não consegue enviar sem preflight de CORS, que
//    este servidor nunca autoriza — e, quando há `Origin`, ele precisa ser da mesma origem do Host.
// 3) Prova do token local: toda chamada a /api/ que não seja GET nem HEAD (e os poucos GET que mudam estado, ver prova-get.ts)
//    leva X-Expediente-Prova, o HMAC do desafio que o servidor emitiu, do método e do caminho. O servidor só é alcançável pelo
//    próprio computador, mas qualquer programa que alcance a porta poderia, por exemplo, decidir uma permissão pendente; o
//    segredo fica num arquivo que só o usuário lê e nunca viaja: quem ocupasse a porta com o Expediente parado não o receberia.
// 4) Proxy: `X-Forwarded-For` com endereço fora do loopback indica pedido repassado de outra máquina.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { isLoopbackBind } from '../config';
import { PROVA_CABECALHO, type Autenticacao } from './autenticacao';
import { getExigeProva } from './prova-get';

/**
 * Nome do host (minúsculo, sem porta e sem colchetes no IPv6) a partir de um cabeçalho Host
 * ou de um `host[:porta]`. Devolve undefined se o valor for inválido.
 */
export function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end < 0) return undefined;
    const rest = v.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return undefined;
    return v.slice(1, end);
  }
  const m = /^([a-z0-9._-]+)(?::\d{1,5})?$/.exec(v);
  return m ? m[1].replace(/\.$/, '') : undefined;
}

function isLoopbackName(name: string): boolean {
  if (name === 'localhost' || name === 'expediente.localhost') return true;
  if (name === '::1') return true;
  return isIP(name) === 4 && name.startsWith('127.');
}

/**
 * Cabeçalho Host local (`localhost`, `expediente.localhost`, 127.x ou `[::1]`; porta ignorada)? Usado pelo terminal
 * somente leitura, que só atende quem abriu o Expediente pelo próprio computador: um IP da rede não serve. Ausente ou inválido: false.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  const name = hostnameOf(host);
  return !!name && isLoopbackName(name);
}

/**
 * Host aceito? IP literal (não há DNS envolvido, logo não há rebinding) ou `localhost`/`expediente.localhost`
 * (os navegadores resolvem sempre para o loopback).
 * Sem cabeçalho Host (HTTP/1.0, ferramentas de linha de comando): aceito — navegadores sempre enviam.
 */
export function hostAllowed(host: string | undefined): boolean {
  if (host === undefined) return true;
  const name = hostnameOf(host);
  if (!name) return false;
  return isIP(name) !== 0 || isLoopbackName(name);
}

/** Origin aceito para requisições que mudam estado: ausente (curl, scripts) ou da mesma origem do Host. */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return host !== undefined && url.host.toLowerCase() === host.trim().toLowerCase();
}

/** `X-Forwarded-For` ausente, ou com todos os endereços no loopback (127.x, ::1, ::ffff:127.x). */
export function forwardedAllowed(value: string | string[] | undefined): boolean {
  if (value === undefined) return true;
  return [value].flat().join(',').split(',').every((addr) => isLoopbackBind(addr));
}

export function isJsonContentType(value: string | undefined): boolean {
  return !!value && /^application\/json\s*(;|$)/i.test(value.trim());
}

function rejectJson(res: ServerResponse, status: number, error: string): void {
  const body = JSON.stringify({ error });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function reject(res: ServerResponse, status: number, message: string): void {
  const body = `${message}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * Devolve um filtro para o início de cada requisição: responde (e devolve true) quando a
 * requisição deve ser recusada; senão devolve false e não toca na resposta. O token é lido a cada escrita.
 */
export function createRequestGuard(auth: Autenticacao): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (!forwardedAllowed(forwarded)) {
      reject(res, 403, 'Pedido repassado de fora do próprio computador.');
      return true;
    }
    const host = req.headers.host;
    if (!hostAllowed(host)) {
      reject(
        res,
        403,
        `Host não permitido: ${String(host).slice(0, 100)}. Abra o Expediente por http://localhost (ou pelo IP).`,
      );
      return true;
    }
    const method = req.method ?? 'GET';
    // Mesma leitura do caminho que o index.ts faz: `/x/../api/...` chega à rota como `/api/...`.
    let url = new URL('/', 'http://localhost');
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      // caminho ilegível: o index.ts também cai em '/'
    }
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const rota = api ? auth.rotaDe(url.pathname) : undefined;
    const leitura = method === 'GET' || method === 'HEAD';
    if (rota === 'desafio') {
      if (leitura) auth.desafio(req, res, url);
      else rejectJson(res, 405, 'método não permitido');
      return true;
    }
    if (leitura && !(api && getExigeProva(url))) return false;
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!leitura && method !== 'OPTIONS' && !originAllowed(origin, host)) {
      reject(res, 403, 'Origem não permitida.');
      return true;
    }
    if (api && rota !== 'troca') {
      const lido = auth.token();
      if (!lido.ok) {
        rejectJson(res, 503, `Escrita bloqueada: ${lido.motivo}. Rode npm run docker:up (ou reinicie o servidor) na pasta do Expediente.`);
        return true;
      }
      if (!auth.confere(req.headers[PROVA_CABECALHO], method, req.url ?? '/', lido.chave)) {
        rejectJson(res, 401, 'Falta a prova do token local, ou ela está errada. Abra o escritório pelo botão do painel do /escritorio ou rode npm run abrir na pasta do Expediente.');
        return true;
      }
    }
    if (leitura || method === 'OPTIONS') return false;
    if (api && !isJsonContentType(req.headers['content-type'])) {
      reject(res, 415, 'Envie o corpo como JSON (Content-Type: application/json).');
      return true;
    }
    if (rota) {
      auth.tratar(rota, req, res);
      return true;
    }
    return false;
  };
}
