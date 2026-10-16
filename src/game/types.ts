export type AbilityType = 'bolt' | 'aoe' | 'tgt' | 'dash' | 'heal' | 'buff';
/** [name, description, type, cooldown (s), mana, value, range/radius, stun (ms)] */
export type Ability = [string, string, AbilityType, number, number, number, number, number?];
export interface HeroDef {
  n: string; role: string; at: string; df: string; c: number;
  hp: number; mp: number; dmg: number; rng: number; as: number; ar: number; mr: number; sp: number;
  g: [number, number, number]; ab: Ability[];
}
export type ItemDef = [name: string, cost: number, bonus: Record<string, number>];
export interface Unit {
  x: number; y: number; team: number; k: string; hp: number; max: number; dmg: number; rng: number; as: number;
  ar: number; mr: number; sp: number; cd: number; tt: number; tgt: Unit | null; dead: boolean; r: number;
  st: number; bf: number; bm: number; ls: number; ap: number;
  [extra: string]: any;
}
export interface GameState {
  t: number; wv: number; q: any[]; ev: any[]; k: [number, number]; st: 'prep' | 'play';
  pause: boolean; over: boolean; win?: number; ft: number; hu: number; mu: number; cu: number; nw: number; camps: any[];
}
