// Modo maquete: tilt-shift sobre o quadro do mundo, em WebGL2. O mundo vira textura, duas passadas
// gaussianas separáveis desfocam com raio crescente à distância vertical da faixa de foco, e o canvas 2D
// fica só com o overlay (nomes, balões, alertas), nítido por cima.
export const FAIXA_DE_FOCO = 0.38;
const RAMPA = 0.4;
const RAIO_MAXIMO_CSS = 30;
const AMORTECIMENTO_S = 0.25;

/** Raio do desfoque (em px CSS) numa linha: `y` e `foco` em fração da altura, 0 no topo. */
export function raioDaLinha(y: number, foco: number, faixa: number = FAIXA_DE_FOCO, raioMax: number = RAIO_MAXIMO_CSS): number {
  const t = Math.min(1, Math.max(0, (Math.abs(y - foco) - faixa / 2) / RAMPA));
  const s = t * t * (3 - 2 * t);
  return s * s * raioMax;
}

/** Aproxima o foco do alvo com amortecimento exponencial (independe da taxa de quadros). */
export function seguirFoco(atual: number, alvo: number, dt: number): number {
  return atual + (alvo - atual) * (1 - Math.exp(-dt / AMORTECIMENTO_S));
}

export function webgl2Disponivel(g: { WebGL2RenderingContext?: unknown } = globalThis): boolean {
  return typeof g.WebGL2RenderingContext === 'function';
}

export const MAQUETE_DICA = 'Desfoca as bordas e deixa o escritório com cara de miniatura; o foco segue o mouse.';
export const MAQUETE_SEM_WEBGL2 = 'Este navegador não oferece WebGL2, que o modo maquete precisa.';
export const MAQUETE_FALHOU = 'O modo maquete não funcionou aqui: a aceleração gráfica do navegador está desligada ou o contexto se perdeu. Recarregue a página para tentar de novo.';

/** Texto e estado do interruptor nas Configurações. */
export function opcaoMaquete(disponivel: boolean, falhou = false): { dica: string; desativada: boolean } {
  if (falhou) return { dica: MAQUETE_FALHOU, desativada: true };
  return disponivel ? { dica: MAQUETE_DICA, desativada: false } : { dica: MAQUETE_SEM_WEBGL2, desativada: true };
}

/** Lembra, até recarregar a página, que o efeito falhou: o interruptor das Configurações fica desativado. */
export class OpcaoMaquete {
  private falhou = false;

  indisponivel(): void {
    this.falhou = true;
  }

  estado(webgl2: boolean): { dica: string; desativada: boolean } {
    return opcaoMaquete(webgl2, this.falhou);
  }
}

export interface CanalDeFalha {
  avisar(): void;
  assinar(cb: () => void): () => void;
}

export function criarCanalDeFalha(): CanalDeFalha {
  const cbs = new Set<() => void>();
  return {
    avisar: () => cbs.forEach((cb) => cb()),
    assinar: (cb) => {
      cbs.add(cb);
      return () => void cbs.delete(cb);
    },
  };
}

/** Falha do efeito: a tela explica o porquê e a preferência volta a desligada. */
export function aoFalharMaquete(tela: { maqueteIndisponivel(): void }, prefs: { updatePrefs(patch: { maquete: boolean }): void }): () => void {
  return () => {
    tela.maqueteIndisponivel();
    prefs.updatePrefs({ maquete: false });
  };
}

const VERTICE = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMUM = `#version 300 es
precision highp float;
uniform sampler2D uFonte;
uniform vec2 uTam;
uniform float uFoco;
uniform float uRaioMax;
out vec4 cor;

float raioDaLinha(float yTopo) {
  float d = abs(yTopo / uTam.y - uFoco);
  return pow(smoothstep(${FAIXA_DE_FOCO / 2}, ${FAIXA_DE_FOCO / 2 + RAMPA}, d), 2.0) * uRaioMax;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 desfocar(sampler2D tex, vec2 dir, float raio) {
  vec3 soma = vec3(0.0);
  float peso = 0.0;
  for (int i = -8; i <= 8; i++) {
    float t = float(i) / 8.0;
    float w = exp(-2.2 * t * t);
    vec3 c = texture(tex, (gl_FragCoord.xy + dir * t * raio) / uTam).rgb;
    w *= 1.0 + 5.0 * smoothstep(0.7, 0.98, luma(c));
    soma += c * w;
    peso += w;
  }
  return soma / peso;
}`;

const PASSADA_H = `${COMUM}
void main() {
  float r = raioDaLinha(uTam.y - gl_FragCoord.y);
  cor = vec4(r < 0.5 ? texelFetch(uFonte, ivec2(gl_FragCoord.xy), 0).rgb : desfocar(uFonte, vec2(1.0, 0.0), r), 1.0);
}`;

const PASSADA_V = `${COMUM}
uniform sampler2D uMeio;
void main() {
  float r = raioDaLinha(uTam.y - gl_FragCoord.y);
  vec3 c = r < 0.5 ? texelFetch(uFonte, ivec2(gl_FragCoord.xy), 0).rgb : desfocar(uMeio, vec2(0.0, 1.0), r);
  float l = luma(c);
  c = mix(vec3(l), c, 1.32);
  c = (c - 0.5) * 1.12 + 0.5;
  c += 0.035 * (1.0 - abs(l * 2.0 - 1.0));
  vec2 q = gl_FragCoord.xy / uTam - 0.5;
  c *= 1.0 - 0.55 * smoothstep(0.28, 0.78, length(q * vec2(1.0, 1.15)));
  cor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function programa(gl: WebGL2RenderingContext, fonteFrag: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [tipo, fonte] of [[gl.VERTEX_SHADER, VERTICE], [gl.FRAGMENT_SHADER, fonteFrag]] as const) {
    const s = gl.createShader(tipo)!;
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'programa');
  return p;
}

function textura(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export interface Efeito {
  /** Copia o quadro de `origem`, desfoca e desenha. `foco` em fração da altura (0 = topo). */
  desenhar(origem: HTMLCanvasElement, foco: number): void;
  liberar(): void;
}

export function criarEfeito(canvas: HTMLCanvasElement): Efeito | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const h = programa(gl, PASSADA_H);
  const v = programa(gl, PASSADA_V);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const fonte = textura(gl);
  const meio = textura(gl);
  const quadro = gl.createFramebuffer();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  let largura = 0;
  let altura = 0;

  const dimensionar = (w: number, a: number) => {
    largura = w;
    altura = a;
    canvas.width = w;
    canvas.height = a;
    gl.bindTexture(gl.TEXTURE_2D, meio);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, a, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, quadro);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, meio, 0);
  };

  const uniformes = (p: WebGLProgram, foco: number, raioMax: number) => {
    gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, 'uTam'), largura, altura);
    gl.uniform1f(gl.getUniformLocation(p, 'uFoco'), foco);
    gl.uniform1f(gl.getUniformLocation(p, 'uRaioMax'), raioMax);
    gl.uniform1i(gl.getUniformLocation(p, 'uFonte'), 0);
  };

  return {
    desenhar(origem, foco) {
      if (origem.width === 0 || origem.height === 0) return;
      if (origem.width !== largura || origem.height !== altura) dimensionar(origem.width, origem.height);
      const raioMax = RAIO_MAXIMO_CSS * (origem.width / (canvas.clientWidth || origem.width));
      gl.viewport(0, 0, largura, altura);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fonte);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, origem);

      gl.bindFramebuffer(gl.FRAMEBUFFER, quadro);
      uniformes(h, foco, raioMax);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      uniformes(v, foco, raioMax);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, meio);
      gl.uniform1i(gl.getUniformLocation(v, 'uMeio'), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fonte);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    liberar() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export interface MaqueteDeps {
  /** Cria um canvas por cima do canvas do mundo, que continua recebendo o mouse. */
  criarCanvas: (id: string) => HTMLCanvasElement;
  criarEfeito: (canvas: HTMLCanvasElement) => Efeito | null;
  reduzirMovimento: () => boolean;
  /** O efeito não pôde rodar (contexto indisponível, shader recusado, contexto perdido): já está desligado. */
  aoFalhar: () => void;
}

export interface Maquete {
  /**
   * Chamado logo depois do desenho do mundo em `mundo`. Ligado: desfoca o quadro num canvas por cima e devolve o
   * contexto de um canvas transparente acima dele, onde o overlay (nomes, balões, alertas) desenha nítido.
   * Desligado: devolve null e não faz nada (sem contexto WebGL, sem canvas).
   */
  aplicar(ligado: boolean, mundo: HTMLCanvasElement, mouseY: number | null, alturaVista: number, dt: number): CanvasRenderingContext2D | null;
  liberar(): void;
}

export function criarMaquete(deps: MaqueteDeps): Maquete {
  let canvas: HTMLCanvasElement | null = null;
  let sobre: HTMLCanvasElement | null = null;
  let ctxSobre: CanvasRenderingContext2D | null = null;
  let efeito: Efeito | null = null;
  let falhou = false;
  let foco = 0.5;

  const desligar = () => {
    const ef = efeito;
    const c = canvas;
    const s = sobre;
    canvas = sobre = null;
    ctxSobre = null;
    efeito = null;
    ef?.liberar();
    c?.remove();
    s?.remove();
  };

  const falha = () => {
    falhou = true;
    desligar();
    deps.aoFalhar();
  };

  return {
    aplicar(ligado, mundo, mouseY, alturaVista, dt) {
      if (!ligado) {
        falhou = false;
        if (canvas) desligar();
        return null;
      }
      if (falhou) return null;
      if (!efeito) {
        try {
          canvas = deps.criarCanvas('maquete');
          efeito = deps.criarEfeito(canvas);
        } catch {
          efeito = null;
        }
        if (!efeito || !canvas) {
          falha();
          return null;
        }
        const deste = canvas;
        deste.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          if (canvas === deste) falha();
        });
        sobre = deps.criarCanvas('maquete-overlay');
        ctxSobre = sobre.getContext('2d');
      }
      const alvo = mouseY !== null && alturaVista > 0 && !deps.reduzirMovimento() ? Math.min(1, Math.max(0, mouseY / alturaVista)) : 0.5;
      foco = seguirFoco(foco, alvo, dt);
      try {
        efeito.desenhar(mundo, foco);
      } catch {
        falha();
        return null;
      }
      if (!sobre || !ctxSobre) return null;
      if (sobre.width !== mundo.width || sobre.height !== mundo.height) {
        sobre.width = mundo.width;
        sobre.height = mundo.height;
      }
      ctxSobre.setTransform(1, 0, 0, 1, 0, 0);
      ctxSobre.clearRect(0, 0, sobre.width, sobre.height);
      return ctxSobre;
    },
    liberar: desligar,
  };
}

export function criarMaqueteDoNavegador(mundo: HTMLCanvasElement, aoFalhar: () => void): Maquete {
  return criarMaquete({
    criarCanvas: (id) => {
      const c = document.createElement('canvas');
      c.id = id;
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;pointer-events:none';
      (id === 'maquete' ? mundo : (document.getElementById('maquete') ?? mundo)).after(c);
      return c;
    },
    criarEfeito,
    aoFalhar,
    reduzirMovimento: () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
}
