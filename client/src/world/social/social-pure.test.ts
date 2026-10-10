// Regras puras da vida social: personalidades, falas e regras das rodas.
import { describe, expect, it } from 'vitest';
import { IDLE_WEIGHTS } from '../sim/behavior';
import { betFor, kindWeight, pickKind, rpsResult, winChance, type Gesture } from './gathering';
import { fill, pick, timeLine } from './lines';
import { bondBetween, personaFor, soloWeights, TRAIT_IDS, TRAITS, type Persona } from './persona';

const T0 = 1_700_000_000_000;

function persona(traits: Persona['traits']): Persona {
  return { traits, sociability: 0.5, skill: 0.5, catchphrase: 'Bora!' };
}

describe('personalidade', () => {
  it('é determinística pela semente: 2 ou 3 traços, sem repetição nem pares que não combinam', () => {
    for (let seed = 1; seed < 400; seed++) {
      const p = personaFor(seed * 7919);
      expect(personaFor(seed * 7919)).toEqual(p);
      expect(p.traits.length === 2 || p.traits.length === 3).toBe(true);
      expect(new Set(p.traits).size).toBe(p.traits.length);
      for (const [a, b] of [
        ['timidez', 'piadas'],
        ['apostas', 'economia'],
      ])
        expect(p.traits.includes(a as never) && p.traits.includes(b as never)).toBe(false);
      expect(p.sociability).toBeGreaterThan(0);
      expect(p.sociability).toBeLessThan(1);
    }
  });

  it('rótulos são substantivos (não dependem do gênero de ninguém) e todo traço tem descrição', () => {
    for (const id of TRAIT_IDS) {
      // nada de adjetivo com gênero ("Competitivo/Competitiva", "Vaidoso/Vaidosa", "Fofoqueiro/Fofoqueira")
      expect(TRAITS[id].label).not.toMatch(/(iv[oa]|os[oa]|ad[oa]|eir[oa])$/i);
      expect(TRAITS[id].desc.length).toBeGreaterThan(20);
      expect(TRAITS[id].emoji).toBeTruthy();
    }
  });

  it('vínculos são simétricos e raros o bastante (amizade mais comum que rivalidade)', () => {
    let friends = 0;
    let rivals = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = (i + 1) * 104729;
        const b = (j + 1) * 104729;
        const k = bondBetween(a, b);
        expect(bondBetween(b, a)).toBe(k);
        if (k === 'amizade') friends++;
        if (k === 'rivalidade') rivals++;
      }
    }
    const pairs = (n * (n - 1)) / 2;
    expect(friends / pairs).toBeGreaterThan(0.12);
    expect(friends / pairs).toBeLessThan(0.45);
    expect(rivals / pairs).toBeGreaterThan(0.04);
    expect(rivals).toBeLessThan(friends);
    expect(bondBetween(5, 5)).toBeNull();
  });

  it('os traços puxam os passeios sozinho (vaidade -> espelho, cafeína -> café)', () => {
    expect(soloWeights(persona(['vaidade'])).mirror).toBeGreaterThan(IDLE_WEIGHTS.mirror * 3);
    expect(soloWeights(persona(['cafeina'])).coffee).toBeGreaterThan(IDLE_WEIGHTS.coffee * 2);
    expect(soloWeights(persona(['calma'])).coffee).toBe(IDLE_WEIGHTS.coffee);
  });
});

describe('falas', () => {
  it('preenche os campos; sem valor para um campo, a fala é descartada', () => {
    expect(fill('Viram o commit de {nome}?', { nome: 'Rafaela' })).toBe('Viram o commit de Rafaela?');
    expect(fill('Jokenpô valendo 🪙{v}?', { v: 10 })).toBe('Jokenpô valendo 🪙10?');
    expect(fill('Ei, {nome}!', {})).toBeNull();
    const rng = () => 0;
    expect(pick(['Ei, {nome}!', 'E aí?'], rng, {})).toBe('E aí?');
    expect(pick(['A', 'B'], rng, {}, 'A')).toBe('B');
  });

  it('dia e hora mudam o papo', () => {
    expect(timeLine(new Date(2026, 9, 9, 15, 0))).toBe('Sextou! 🎉'); // sexta à tarde
    expect(timeLine(new Date(2026, 9, 5, 9, 0))).toBe('Segunda-feira, né…');
    expect(timeLine(new Date(2026, 9, 7, 12, 30))).toMatch(/almoço/);
    expect(timeLine(new Date(2026, 9, 7, 16, 0))).toBeNull();
  });
});

describe('regras das rodas', () => {
  it('jokenpô: pedra ganha da tesoura, tesoura do papel, papel da pedra', () => {
    const g: Gesture[] = ['rock', 'paper', 'scissors'];
    expect(rpsResult('rock', 'scissors')).toBe(1);
    expect(rpsResult('scissors', 'paper')).toBe(1);
    expect(rpsResult('paper', 'rock')).toBe(1);
    expect(rpsResult('scissors', 'rock')).toBe(2);
    for (const x of g) expect(rpsResult(x, x)).toBe(0);
  });

  it('aposta: jokenpô sempre vale algo (até o menor saldo); sem moedinhas, só pela honra; economia aposta pouco', () => {
    const rng = () => 0.5;
    const a = persona(['calma']);
    expect(betFor('rps', a, a, 100, 100, null, rng)).toBe(10);
    expect(betFor('rps', persona(['apostas']), a, 100, 100, null, rng)).toBe(20);
    expect(betFor('rps', persona(['apostas']), a, 100, 7, null, rng)).toBe(7);
    expect(betFor('rps', a, a, 100, 0, null, rng)).toBe(0);
    expect(betFor('rps', persona(['economia']), a, 100, 100, null, rng)).toBe(5);
    expect(betFor('kitchen', a, a, 100, 100, null, rng)).toBe(0);
    // partidas: só entre rivais (ou com quem é de apostas)
    expect(betFor('pingpong', a, a, 100, 100, null, rng)).toBe(0);
    expect(betFor('pingpong', a, a, 100, 100, 'rivalidade', rng)).toBe(15);
  });

  it('habilidade pesa, mas ninguém ganha (ou perde) sempre', () => {
    expect(winChance(0.5, 0.5)).toBeCloseTo(0.5);
    expect(winChance(0.95, 0.05)).toBe(0.85);
    expect(winChance(0.05, 0.95)).toBe(0.15);
  });

  it('a personalidade escolhe a roda entre as possíveis', () => {
    expect(kindWeight('tv', persona(['series']))).toBeGreaterThan(kindWeight('tv', persona(['calma'])));
    expect(kindWeight('rps', persona(['apostas']))).toBeGreaterThan(kindWeight('kitchen', persona(['apostas'])));
    let seq = 0;
    const rng = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const k = pickKind(rng, persona(['games']), { videogame: true, kitchen: true, talk: true });
      counts[k!] = (counts[k!] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['kitchen', 'talk', 'videogame']);
    expect(counts.videogame).toBeGreaterThan(counts.talk);
    expect(pickKind(rng, persona([]), {})).toBeNull();
  });
});
