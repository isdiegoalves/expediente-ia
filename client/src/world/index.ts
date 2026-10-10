// Mundo do escritório: liga a simulação (sim/), o desenho (render/), a câmera e a entrada,
// e implementa o contrato WorldApi consumido pela UI.
import * as artModule from '../art';
import { TILE, type ArtModule } from '../art/api';
import type { OfficeStore } from '../net/store';
import { DEFAULT_WORLD_OPTIONS, type Selection, type SocialEvent, type SoundCue, type WorldApi, type WorldOptions, type WorldPlayback } from './api';
import { loadWorldAssets, type WorldAssets } from './assets';
import { Camera, overviewFrame } from './camera';
import { createDebug, type WorldDebug } from './debug';
import { BUILDING_H, COL_W } from './constants';
import { inRect } from './layout/geometry';
import { attachInput, type Hit } from './input';
import { rebaseSnapshot } from './playback';
import { criarMaqueteDoNavegador } from './render/maquete';
import { Overlay } from './render/overlay';
import { Renderer } from './render/renderer';
import { rodaAbertaApos, rodaNoPonto } from './render/roda';
import { Ritmo } from './ritmo';
import { Sim } from './sim/sim';
import { SoundCues } from './sound-cues';

export * from './api';
export type { WorldDebug } from './debug';

const art: ArtModule = artModule;

export function createWorld(canvas: HTMLCanvasElement, store: OfficeStore): WorldApi & { debug: WorldDebug } {
  let options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS };
  const camera = new Camera();
  // Simulação e desenho são recriados quando o timelapse entra, pula ou sai (rebuild).
  const maquete = criarMaqueteDoNavegador(canvas);
  let sim = new Sim(art, () => options);
  let renderer = new Renderer(canvas, art, sim, camera);
  let overlay = new Overlay(renderer.ctx, sim, renderer, camera);
  let assets: WorldAssets | null = null;
  /** Timelapse ligado: relógio próprio do mundo (`worldNow`), acelerado pelo fator de animação. */
  let playback: WorldPlayback | null = null;
  let worldNow = 0;
  const selectCbs = new Set<(s: Selection) => void>();
  const hoverCbs = new Set<(id: string | null) => void>();
  const socialCbs = new Set<(e: SocialEvent) => void>();
  const soundCbs = new Set<(c: SoundCue) => void>();
  const roomMenuCbs = new Set<(roomId: string, at: { x: number; y: number }) => void>();
  let cues = new SoundCues(sim, camera);
  let selection: Selection = null;
  let hover: string | null = null;
  let hoverPointer = false;
  let mouse: { x: number; y: number } | null = null;
  let raf = 0;
  let rafTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTs = 0;
  let hiddenAt = 0;
  const ritmo = new Ritmo(performance.now());
  let userMoved = false;
  let framed = false;
  let lastCols = -1;
  const abort = new AbortController();

  const acordar = () => {
    ritmo.acordar(performance.now());
    if (rafTimer === null) return;
    clearTimeout(rafTimer);
    rafTimer = null;
    raf = requestAnimationFrame(loop);
  };

  // ------------------------------------------------------------------ tamanho/DPR

  const resize = () => {
    acordar();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    camera.setView(w, h, dpr);
    updateBounds();
  };

  const buildingRect = () => ({ x: 0, y: 0, w: sim.building.cols * COL_W * TILE, h: BUILDING_H * TILE });

  const updateBounds = () => {
    const b = buildingRect();
    camera.bounds = { x: b.x - 7 * TILE, y: b.y - 6 * TILE, w: b.w + 14 * TILE, h: b.h + 18 * TILE };
    const fit = camera.fitZoom(b, 16);
    camera.minZoom = Math.min(1, Math.max(0.25, fit));
    camera.clamp();
  };

  const overviewTarget = () => {
    const f = overviewFrame(buildingRect(), camera.viewW, camera.viewH, camera.insets);
    const fit = Math.max(camera.minZoom, f.zoom);
    const snapped = camera.snapZoom(fit, 'down');
    const zoom = snapped >= fit * 0.82 ? snapped : fit;
    const z = Math.min(zoom, 4);
    const c = camera.centerFor(f.cx, f.cy, z);
    // as margens de tela (pílulas acima, meio-fio abaixo) não são simétricas
    return { x: c.x, y: c.y - f.dy / z, zoom: z };
  };

  const overview = (animate = true) => {
    camera.follow = null;
    const o = overviewTarget();
    if (animate) camera.animateTo(o.x, o.y, o.zoom, Date.now(), 420);
    else {
      camera.stop();
      camera.x = o.x;
      camera.y = o.y;
      camera.zoom = o.zoom;
      camera.clamp();
    }
  };

  // ------------------------------------------------------------------ seleção e foco

  const emitSelect = () => selectCbs.forEach((cb) => cb(selection));

  const sameSelection = (a: Selection, b: Selection) => a === b || (!!a && !!b && a.type === b.type && a.id === b.id);

  const setSelection = (sel: Selection, focus = false) => {
    const same = sameSelection(sel, selection);
    selection = sel;
    if (!sel) sim.fanout.aberta = null;
    // com "seguir selecionado" ligado, a câmera acompanha o agente escolhido (ou para de seguir)
    if (options.followSelected) camera.follow = sel?.type === 'agent' ? sel.id : null;
    if (focus && sel) {
      if (sel.type === 'agent') focusAgent(sel.id, { follow: options.followSelected });
      else focusRoom(sel.id);
    }
    if (!same) emitSelect();
  };

  /** Onde está a roda de quem não tem personagem próprio (subagente na roda da equipe). */
  const rodaDe = (id: string) => {
    const r = sim.fanout.rodaDe(id);
    const room = r && sim.rooms.get(r.roomId);
    return room?.present ? sim.fanout.lugar(room) : null;
  };

  const focusAgent = (id: string, opts: { follow?: boolean } = {}) => {
    acordar();
    const ch = sim.chars.get(id);
    const alvo = ch ?? rodaDe(id);
    if (!alvo) return;
    userMoved = true;
    const zoom = Math.max(camera.zoom, camera.snapZoom(3));
    const c = camera.centerFor(alvo.x, alvo.y - 12, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
    camera.follow = ch && opts.follow ? id : null;
  };

  const focusRoom = (id: string) => {
    acordar();
    const room = sim.rooms.get(id);
    if (!room) return;
    userMoved = true;
    camera.follow = null;
    const r = room.layout.rect;
    const rect = { x: r.x * TILE, y: r.y * TILE - 8, w: r.w * TILE, h: r.h * TILE + 16 };
    const fit = camera.fitZoom(rect, 40);
    const zoom = Math.min(4, Math.max(camera.minZoom, camera.snapZoom(fit, 'down')));
    const c = camera.centerFor(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
  };

  const zoomStep = (steps: number, sx = camera.viewW / 2, sy = camera.viewH / 2) => {
    userMoved = true;
    camera.zoomAt(camera.stepZoom(steps), sx, sy, Date.now(), true);
  };

  // ------------------------------------------------------------------ hit-test

  const pick = (sx: number, sy: number): Hit => {
    const naLista = overlay.alvoDaRoda(sx, sy);
    if (naLista) return naLista;
    const w = camera.screenToWorld(sx, sy);
    let best: string | null = null;
    let bestDepth = -Infinity;
    const slack = Math.max(1, 3 / camera.zoom);
    for (const [id, h] of renderer.heads) {
      if (!h.visible) continue;
      if (w.x < h.bx - slack || w.x > h.bx + h.bw + slack || w.y < h.by - slack || w.y > h.by + h.bh + slack) continue;
      if (h.depth > bestDepth) {
        bestDepth = h.depth;
        best = id;
      }
    }
    if (best) return { type: 'agent', id: best };
    const roda = rodaNoPonto(w.x, w.y, sim.fanout.rodas.values(), (id) => sim.rooms.get(id));
    if (roda) return { type: 'grupo', id: roda };
    const tx = Math.floor(w.x / TILE);
    const ty = Math.floor(w.y / TILE);
    for (const room of sim.rooms.values()) if (room.present && !room.ghost && inRect(room.layout.rect, tx, ty)) return { type: 'room', id: room.id };
    return null;
  };

  const setHover = (id: string | null, pointer = !!id) => {
    if (pointer !== hoverPointer) {
      hoverPointer = pointer;
      canvas.style.cursor = pointer ? 'pointer' : 'grab';
    }
    if (id === hover) return;
    hover = id;
    hoverCbs.forEach((cb) => cb(id));
  };

  const detachInput = attachInput(canvas, camera, {
    pick,
    click: (hit) => {
      sim.fanout.aberta = rodaAbertaApos(sim.fanout.aberta, hit, (id) => sim.fanout.membro(id));
      if (hit?.type !== 'grupo') setSelection(hit);
    },
    doubleClick: (hit) => {
      if (hit?.type === 'grupo') {
        sim.fanout.aberta = hit.id;
        focusRoom(hit.id);
      } else if (hit?.type === 'agent') {
        setSelection(hit);
        focusAgent(hit.id, { follow: true });
      } else if (hit?.type === 'room') focusRoom(hit.id);
    },
    hover: (sx, sy, inside) => {
      mouse = inside ? { x: sx, y: sy } : null;
      if (!inside) setHover(null);
    },
    interact: () => {
      userMoved = true;
      camera.follow = null;
      camera.stop();
    },
    overview: () => overview(true),
    zoomStep,
  });

  // ------------------------------------------------------------------ dados

  const onSnapshot = () => {
    const snap = store.snapshot;
    if (!snap) return;
    if (ritmo.observarSnapshot(snap, performance.now())) acordar();
    try {
      // No timelapse, os horários do snapshot vão para o relógio do mundo (world/playback.ts).
      if (playback) sim.applySnapshot(rebaseSnapshot(snap, worldNow - snap.serverTime), worldNow);
      else sim.applySnapshot(snap, Date.now());
    } catch (err) {
      console.error('[mundo] snapshot inválido ignorado', err);
    }
  };
  const offSnapshot = store.on('snapshot', onSnapshot);
  const offNotice = store.on('notice', acordar);
  if (store.snapshot) onSnapshot();

  void loadWorldAssets().then((a) => {
    if (!a) return;
    assets = a;
    renderer.setAssets(a);
  });

  // medições de texto em cache: refaz quando alguma fonte termina de carregar
  if (document.fonts) document.fonts.addEventListener?.('loadingdone', () => overlay.resetCaches());

  // ------------------------------------------------------------------ laço

  const loop = (ts: number) => {
    raf = 0;
    rafTimer = null;
    const real = Date.now();
    if (playback || camera.animating) ritmo.acordar(ts);
    const realDt = lastTs ? Math.min(ritmo.calmo(ts) ? 0.25 : 0.1, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    // Timelapse: simulação e desenho no relógio do mundo (acelerado ou parado); a câmera segue no tempo real.
    const k = playback ? Math.max(0, playback.scale()) : 1;
    const dt = realDt * k;
    if (playback) worldNow += dt * 1000;
    const now = playback ? worldNow : real;
    try {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      if (canvas.clientWidth !== camera.viewW || canvas.clientHeight !== camera.viewH || dpr !== camera.dpr) resize();
      sim.update(dt, now);
      // partidas e apostas resolvidas: para o feed (as do timelapse são encenação do passado: ficam fora)
      const events = sim.social.events;
      if (events.length) {
        if (!playback) for (const e of events) for (const cb of socialCbs) cb(e);
        events.length = 0;
      }
      renderer.sync(options.theme);
      if (sim.building.cols !== lastCols) {
        lastCols = sim.building.cols;
        updateBounds();
        if (!framed && sim.initialized) {
          overview(false);
          framed = true;
        } else if (!userMoved) overview(true);
      }
      const followCh = camera.follow ? sim.chars.get(camera.follow) : undefined;
      if (camera.follow && !followCh) camera.follow = null;
      camera.update(real, followCh ? camera.centerFor(followCh.x, followCh.y - 12, camera.zoom) : null, realDt);
      renderer.frame(now, dt, options, { agent: selection?.type === 'agent' ? selection.id : null, room: selection?.type === 'room' ? selection.id : null, hover });
      overlay.usarContexto(maquete.aplicar(!!options.maquete, canvas, mouse?.y ?? null, camera.viewH, realDt) ?? renderer.ctx);
      overlay.draw(now, options, { agent: selection?.type === 'agent' ? selection.id : null, room: selection?.type === 'room' ? selection.id : null, hover });
      renderer.pruneHeads();
      // No timelapse o mundo fica mudo: o teclado e o elevador em alta velocidade só fariam barulho.
      if (soundCbs.size && !playback) cues.update(now, (c) => soundCbs.forEach((cb) => cb(c)));
      if (mouse) {
        const hit = pick(mouse.x, mouse.y);
        setHover(hit?.type === 'agent' && sim.chars.has(hit.id) ? hit.id : null, hit?.type === 'agent' || hit?.type === 'grupo');
      }
      // seleção de quem já foi embora
      if (selection?.type === 'agent' && !sim.chars.has(selection.id) && !sim.fanout.membro(selection.id)) setSelection(null);
      if (selection?.type === 'room' && !sim.rooms.has(selection.id)) setSelection(null);
    } catch (err) {
      console.error('[mundo] erro no frame', err);
    } finally {
      const espera = ritmo.esperaMs(performance.now(), ts);
      if (espera > 0) {
        rafTimer = setTimeout(() => {
          rafTimer = null;
          raf = requestAnimationFrame(loop);
        }, espera);
      } else raf = requestAnimationFrame(loop);
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    lastTs = 0;
    acordar();
    if (hiddenAt && Date.now() - hiddenAt > 5000) sim.fastForward(playback ? worldNow : Date.now());
    hiddenAt = 0;
  };

  // Botão direito numa sala (ou num agente dentro dela): a UI oferece renomear a sala.
  const onContextMenu = (e: MouseEvent) => {
    if (!roomMenuCbs.size) return;
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const hit = pick(sx, sy);
    const w = camera.screenToWorld(sx, sy);
    const roomId =
      hit?.type === 'room'
        ? hit.id
        : hit?.type === 'agent'
          ? (sim.chars.get(hit.id)?.roomId ?? null)
          : ([...sim.rooms.values()].find((room) => room.present && !room.ghost && inRect(room.layout.rect, Math.floor(w.x / TILE), Math.floor(w.y / TILE)))?.id ?? null);
    if (!roomId || !sim.rooms.has(roomId)) return;
    e.preventDefault();
    roomMenuCbs.forEach((cb) => cb(roomId, { x: e.clientX, y: e.clientY }));
  };
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  for (const tipo of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(tipo, acordar, { passive: true, signal: abort.signal });
  resize();
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------------ depuração

  const markMoved = () => (userMoved = true);
  let debug = createDebug(sim, renderer, camera, markMoved);

  // ------------------------------------------------------------------ timelapse

  /**
   * Recomeça simulação e desenho do zero (o próximo snapshot é a carga inicial: todos já no lugar).
   * No timelapse os snapshots não trazem as rodas do servidor: a agenda e as carteiras ficam só em memória.
   */
  const rebuild = () => {
    sim = new Sim(art, () => options);
    renderer = new Renderer(canvas, art, sim, camera);
    if (assets) renderer.setAssets(assets);
    if (playback) {
      const p = playback;
      renderer.clock = () => p.clock();
    }
    overlay = new Overlay(renderer.ctx, sim, renderer, camera);
    debug = createDebug(sim, renderer, camera, markMoved);
    cues = new SoundCues(sim, camera);
    lastCols = -1;
    setHover(null);
  };

  return {
    select: (sel, opts) => {
      acordar();
      setSelection(sel, !!opts?.focus);
    },
    getSelection: () => selection,
    onSelect: (cb) => {
      selectCbs.add(cb);
      return () => void selectCbs.delete(cb);
    },
    onHover: (cb) => {
      hoverCbs.add(cb);
      return () => void hoverCbs.delete(cb);
    },
    focusAgent,
    focusRoom,
    overview: () => {
      acordar();
      userMoved = false;
      overview(true);
    },
    zoomBy: (factor) => {
      acordar();
      if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
      const target = camera.snapZoom(camera.zoom * factor, factor > 1 ? 'up' : 'down');
      if (Math.abs(target - camera.zoom) < 1e-3) zoomStep(factor > 1 ? 1 : -1);
      else {
        userMoved = true;
        camera.zoomAt(target, camera.viewW / 2, camera.viewH / 2, Date.now(), true);
      }
    },
    getOptions: () => ({ ...options }),
    setOptions: (o) => {
      acordar();
      options = { ...options, ...o };
      if (o.followSelected !== undefined) camera.follow = o.followSelected && selection?.type === 'agent' ? selection.id : null;
    },
    setViewInsets: (ins) => {
      acordar();
      const v = (n: number | undefined, cur: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : cur);
      const cur = camera.insets;
      camera.insets = { top: v(ins.top, cur.top), right: v(ins.right, cur.right), bottom: v(ins.bottom, cur.bottom), left: v(ins.left, cur.left) };
      updateBounds();
      if (!userMoved && framed) overview(true);
    },
    screenPositionOf: (id) => {
      const h = renderer.heads.get(id);
      const roda = h ? null : rodaDe(id);
      const alvo = h?.visible ? { x: h.x, y: h.y - 2 } : roda ? { x: roda.x, y: roda.y - 34 } : null;
      if (!alvo) return null;
      const p = camera.worldToScreen(alvo.x, alvo.y);
      if (p.x < 0 || p.y < 0 || p.x > camera.viewW || p.y > camera.viewH) return null;
      return p;
    },
    social: (id) => sim.social.info(id),
    onRoomContextMenu: (cb) => {
      roomMenuCbs.add(cb);
      return () => void roomMenuCbs.delete(cb);
    },
    onSocialEvent: (cb) => {
      socialCbs.add(cb);
      return () => void socialCbs.delete(cb);
    },
    setPlayback: (p) => {
      acordar();
      playback = p;
      worldNow = p ? p.clock() : 0;
      rebuild();
    },
    onSound: (cb) => {
      soundCbs.add(cb);
      return () => void soundCbs.delete(cb);
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      maquete.liberar();
      if (rafTimer !== null) clearTimeout(rafTimer);
      abort.abort();
      offSnapshot();
      offNotice();
      detachInput();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('visibilitychange', onVisibility);
      selectCbs.clear();
      hoverCbs.clear();
      socialCbs.clear();
      soundCbs.clear();
    },
    get debug() {
      return debug;
    },
  };
}
