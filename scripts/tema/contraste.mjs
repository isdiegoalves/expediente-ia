// Relatório de contraste do tema candidato: mede os pares de `contraste` com o mesmo cálculo do pré-voo
// (shared/tema/validar.ts) e, para cada texto reprovado, propõe a menor mudança de luminosidade que o aprova.
import { corPorCaminho, medirContraste } from '../../shared/tema/validar.ts';
import { alfaDe, deHsl, paraHsl } from './cor.mjs';

const clonar = (o) => JSON.parse(JSON.stringify(o));

function definir(paleta, caminho, valor) {
  const partes = caminho.split('.');
  const ultimo = partes.pop();
  const pai = partes.length ? corPorCaminho(paleta, partes.join('.')) : paleta;
  pai[ultimo] = valor;
}

function medirPar(paleta, par) {
  const r = medirContraste({ paleta, contraste: [par] });
  return r.medidas[0] ? { ...par, razao: r.medidas[0].razao } : { ...par, erro: r.erros[0] };
}

/** Menor passo de 0,5 ponto de luminosidade (HSL) no texto que faz todos os pares dele passarem; null se nem a ponta resolve. */
function propor(paleta, token, pares) {
  const atual = corPorCaminho(paleta, token);
  const [h, s, l] = paraHsl(atual);
  const alfa = alfaDe(atual);
  for (let passo = 1; passo <= 200; passo++) {
    for (const sentido of [1, -1]) {
      const nl = l + (sentido * passo) / 200;
      if (nl < 0 || nl > 1) continue;
      const novo = deHsl([h, s, nl], alfa);
      const teste = clonar(paleta);
      definir(teste, token, novo);
      const medidas = pares.map((p) => medirPar(teste, p));
      if (medidas.every((m) => m.razao !== undefined && m.razao >= m.min)) return { de: atual, para: novo, luminosidadeDe: l, luminosidadePara: nl, maisJusto: Math.min(...medidas.map((m) => m.razao)) };
    }
  }
  return null;
}

/** `propostas` é por texto, já considerando todos os pares em que ele aparece. */
export function analisar(tema) {
  const medidas = tema.contraste.map((p) => medirPar(tema.paleta, p));
  const reprovados = medidas.filter((m) => m.razao === undefined || m.razao < m.min);
  const propostas = new Map();
  for (const token of new Set(reprovados.map((m) => m.texto))) {
    propostas.set(token, propor(tema.paleta, token, tema.contraste.filter((p) => p.texto === token)));
  }
  return { medidas, reprovados, propostas };
}

const pct = (l) => `${(l * 100).toFixed(1).replace('.', ',')}%`;
const rz = (n) => `${n.toFixed(2).replace('.', ',')}:1`;
const min = (m) => `${String(m).replace('.', ',')}:1`;

export function relatorio(tema) {
  const { medidas, reprovados, propostas } = analisar(tema);
  const linhas = [`Contraste WCAG AA do tema "${tema.id}": ${medidas.length} pares, ${reprovados.length} reprovado(s). Mínimo 4,5:1 para texto normal e 3:1 para indicador.`];
  if (reprovados.length) {
    linhas.push('', 'REPROVADOS');
    for (const m of reprovados) {
      linhas.push(`  ✗ ${m.texto} sobre ${m.fundo}${m.sobre ? ` (composto sobre ${m.sobre})` : ''}: ${m.razao === undefined ? m.erro : `${rz(m.razao)}, mínimo ${min(m.min)}`}`);
    }
    linhas.push('', 'AJUSTE PROPOSTO (a menor mudança de luminosidade do texto; não foi aplicado)');
    for (const [token, p] of propostas) {
      linhas.push(
        p
          ? `  ${token}: ${p.de} -> ${p.para} (luminosidade ${pct(p.luminosidadeDe)} -> ${pct(p.luminosidadePara)}); passa em todos os pares dele, o mais justo com ${rz(p.maisJusto)}`
          : `  ${token}: nenhuma luminosidade resolve só trocando o texto; mude a cor do fundo do par`,
      );
    }
  }
  const aprovados = medidas.filter((m) => !reprovados.includes(m));
  if (aprovados.length) {
    linhas.push('', 'APROVADOS');
    for (const m of aprovados) linhas.push(`  ✓ ${m.texto} sobre ${m.fundo}: ${rz(m.razao)} (mínimo ${min(m.min)})`);
  }
  return { texto: linhas.join('\n'), reprovados: reprovados.length, propostas };
}

export function aplicarPropostas(tema, propostas) {
  const novo = clonar(tema);
  for (const [token, p] of propostas) if (p) definir(novo.paleta, token, p.para);
  return novo;
}
