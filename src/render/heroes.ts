import * as THREE from 'three';
import { both, box, cone, cyl, finish, humanoid, mir, oct, sph, tor } from './rigs';
import type { Palette, Prim, RigDef } from './rigs';

/**
 * Rig definitions for the five heroes, the two lane creeps, the jungle monster and the boss.
 * Weapons are authored in forearm space: the origin is the elbow, the hand is at (0, -0.35, 0) and +Z is where
 * the forearm points when the elbow is bent, so a blade along +Z points forward/up in the ready stance.
 */

const PI = Math.PI, H = PI / 2;
const HAND_Y = -.35;
const on = (B: ReturnType<typeof humanoid>, bone: string, ...p: Prim[]) => { B[bone].prims.push(...p); };
const onBoth = (B: ReturnType<typeof humanoid>, bone: string, ...p: Prim[]) => { on(B, bone + 'L', ...p.map(mir)); on(B, bone + 'R', ...p); };

/** A blade along +Z held in the fist: grip, guard, pommel, tapered blade and an optional glowing edge. */
const blade = (len: number, w: number, o: { glow?: boolean; guard?: number; metal?: string; grip?: string; thick?: number } = {}): Prim[] => {
  const th = o.thick ?? .03;
  return [
    cyl(o.grip ?? 'd', [0, HAND_Y, 0], [.035, .24, .035], { r: [H, 0, 0] }),
    sph('m', [0, HAND_Y, -.14], [.05, .05, .05]),
    box('m', [0, HAND_Y, .13], [o.guard ?? .3, .05, .06]),
    box(o.metal ?? 'm', [0, HAND_Y, .16 + len / 2], [w, len, th], { r: [H, 0, 0], t: [.25, .6] }),
    ...(o.glow ? [box('g', [0, HAND_Y, .16 + len / 2 - .02], [w * .3, len * .85, th + .012], { r: [H, 0, 0], t: [.6, 1], g: true })] : []),
  ];
};

/** A staff held upright: the shaft is long along +Z, centred on the hand. */
const staff = (len: number, shaft: string): Prim[] => [
  cyl(shaft, [0, HAND_Y, len / 2 - 1], [.045, len, .045], { r: [H, 0, 0] }),
  cyl('d', [0, HAND_Y, 0], [.058, .3, .058], { r: [H, 0, 0] }),
];

function knight(): RigDef {
  const B = humanoid({ bulk: 1.28, aw: 1.3, lw: 1.2, headR: 1.05, skinHead: false, torso: 'a', pelvis: 'b', arm: 'a', fore: 'm', hand: 'm', leg: 'b', shin: 'm', boot: 'a' });
  on(B, 'spine',
    box('c', [0, .2, .2], [.34, .62, .03]), box('t', [0, .4, .22], [.1, .7, .02], { r: [0, 0, .62], g: true }), oct('g', [0, .46, .22], [.07, .09, .03], { g: true }),
    box('m', [0, .66, 0], [.46, .08, .3]),
    // Cape: broad shoulders that taper into a long tail, so the back reads as a cloak rather than a slab.
    box('t', [0, .44, -.19], [.6, .34, .05], { b: [.92, 1] }), box('t', [0, .02, -.215], [.55, .55, .045], { b: [.5, 1] }), box('m', [0, .6, -.17], [.5, .05, .1]));
  onBoth(B, 'arm', sph('m', [-.02, .05, 0], [.24, .17, .23]), cyl('a', [-.02, -.03, 0], [.2, .05, .2]));
  on(B, 'head',
    sph('m', [0, .27, 0], [.24, .26, .24]), box('d', [0, .28, .225], [.2, .045, .05]), box('m', [0, .21, .23], [.045, .22, .03]),
    box('s', [0, .15, .17], [.18, .1, .08]), box('t', [0, .55, -.04], [.07, .17, .42], { t: [1, .6] }), cone('t', [0, .5, -.34], [.07, .38, .05], { r: [1.95, 0, 0] }));
  onBoth(B, 'shin', sph('m', [0, 0, .06], [.115, .115, .1]));
  // Kite shield (left forearm) and arcane broadsword (right).
  // The shield is twisted about the forearm so its face turns forward: seen from the front it is a plate, not a thin edge.
  const sy = -.5;
  on(B, 'foreL', box('a', [.15, -.2, .1], [.08, .66, .6], { b: [1, .35], r: [0, sy, 0] }), box('m', [.2, -.2, .1], [.03, .7, .64], { b: [1, .35], t: [1, 1], r: [0, sy, 0] }), oct('g', [.23, -.16, .14], [.025, .14, .13], { g: true, r: [0, sy, 0] }));
  on(B, 'foreR', ...blade(1.1, .17, { glow: true, guard: .42, thick: .045 }));
  return finish('arcane-knight', 'blade', 2.32, B, [{ bone: 'foreR', base: [0, HAND_Y, .55], tip: [0, HAND_Y, 1.3] }]);
}

function huntress(): RigDef {
  const B = humanoid({ bulk: .82, aw: .82, lw: .86, headR: .95, skinHead: true, torso: 'a', pelvis: 'a', arm: 'a', fore: 'd', hand: 'd', leg: 'a', shin: 'd', boot: 'd', eyes: 'g' });
  on(B, 'head',
    sph('a', [0, .3, -.1], [.25, .26, .24]), cone('a', [0, .4, -.36], [.12, .52, .1], { r: [-1.2, 0, 0] }),
    box('d', [0, .19, .165], [.2, .1, .07], { b: [.85, .8] }), box('a', [0, .385, .15], [.34, .06, .1]), box('h', [0, .34, .18], [.2, .05, .04]));
  on(B, 'spine',
    cone('b', [0, -.1, -.2], [.36, .95, .05], { r: [0, 0, PI] }), cone('a', [.1, -.2, -.21], [.2, .7, .04], { r: [0, 0, PI] }),
    box('d', [0, .4, .17], [.08, .62, .03], { r: [0, 0, .55] }), box('b', [0, .1, 0], [.5, .16, .33]),
    tor('c', [0, .62, 0], [.17, .17, .17], { r: [H, 0, 0], k: .3 }), box('c', [.1, .5, -.18], [.08, .42, .03], { r: [.25, 0, .2] }));
  onBoth(B, 'arm', sph('b', [0, .03, 0], [.14, .1, .14]));
  on(B, 'hips', box('a', [0, -.22, .14], [.32, .42, .03], { b: [.7, 1] }), box('a', [0, -.22, -.14], [.32, .42, .03], { b: [.7, 1] }), ...both(box('m', [.26, .0, .03], [.03, .24, .03], { r: [.1, 0, .1] })));
  on(B, 'foreR', ...blade(.62, .09, { glow: true, guard: .16 }));
  on(B, 'foreL', ...blade(.62, .09, { glow: true, guard: .16 }));
  return finish('shadow-huntress', 'dual', 2.24, B, [{ bone: 'foreR', base: [0, HAND_Y, .42], tip: [0, HAND_Y, .82] }, { bone: 'foreL', base: [0, HAND_Y, .42], tip: [0, HAND_Y, .82] }]);
}

function mage(): RigDef {
  const B = humanoid({ bulk: .9, aw: .85, lw: .9, headR: 1, skinHead: true, torso: 'a', pelvis: 'a', arm: 'a', fore: 'a', hand: 's', leg: 'a', shin: 'a', boot: 'd' });
  on(B, 'hips', cone('a', [0, -.44, 0], [.52, .98, .46]), tor('c', [0, -.92, 0], [.5, .5, .45], { r: [H, 0, 0], k: .06 }), box('c', [0, .09, .16], [.52, .1, .03]), box('g', [.08, -.3, .22], [.06, .5, .02], { g: true, r: [0, 0, .05] }));
  on(B, 'spine', sph('b', [0, .6, 0], [.34, .15, .27]), oct('g', [0, .4, .19], [.05, .075, .02], { g: true }), box('b', [0, .12, 0], [.46, .12, .32]));
  on(B, 'head',
    cyl('b', [0, .46, 0], [.46, .035, .46]), cone('a', [0, .76, -.05], [.27, .62, .27], { r: [-.25, 0, 0] }), cyl('g', [0, .5, 0], [.27, .06, .27], { g: true }),
    oct('g', [0, .53, .24], [.05, .05, .03], { g: true }), box('h', [0, .17, -.16], [.3, .42, .1]));
  on(B, 'foreR', ...staff(2.2, 'w'),
    tor('w', [0, HAND_Y, 1.2], [.15, .15, .15], { k: .18 }), sph('g', [0, HAND_Y, 1.3], [.14, .14, .14], { g: true }), oct('g', [0, HAND_Y + .1, 1.52], [.04, .07, .04], { g: true }), oct('g', [.08, HAND_Y - .02, 1.55], [.03, .05, .03], { g: true }));
  on(B, 'foreL', sph('g', [0, -.52, .22], [.09, .09, .09], { g: true }), tor('g', [0, -.52, .22], [.16, .16, .16], { r: [1.2, .3, 0], k: .05, g: true }));
  return finish('ember-mage', 'robe', 2.74, B, [{ bone: 'foreR', base: [0, HAND_Y, 1.0], tip: [0, HAND_Y, 1.52] }]);
}

function guardian(): RigDef {
  const B = humanoid({ bulk: .95, aw: .9, lw: .92, headR: 1, skinHead: true, torso: 'x', pelvis: 'b', arm: 's', fore: 'b', hand: 's', leg: 'b', shin: 'b', boot: 'x' });
  on(B, 'spine', tor('b', [0, .26, 0], [.34, .34, .3], { r: [H, 0, 0], k: .09 }), sph('c', [0, .64, 0], [.3, .1, .24]), oct('g', [0, .4, .19], [.05, .07, .02], { g: true }), cone('b', [0, .18, -.2], [.3, .8, .05], { r: [0, 0, PI] }));
  onBoth(B, 'arm', cone('c', [-.14, .1, 0], [.17, .5, .04], { r: [0, 0, 1.0] }), cone('b', [-.1, .02, 0], [.12, .36, .04], { r: [0, 0, 1.25] }));
  const skirt: Prim[] = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; skirt.push(cone(i % 2 ? 'c' : 'a', [Math.cos(a) * .27, -.22, Math.sin(a) * .27], [.13, .5, .035], { r: [0, H - a, PI] })); }
  on(B, 'hips', ...skirt, tor('c', [0, .05, 0], [.27, .27, .24], { r: [H, 0, 0], k: .08 }));
  on(B, 'head',
    tor('c', [0, .4, 0], [.22, .22, .2], { r: [H, 0, 0], k: .1 }), box('h', [0, .15, -.17], [.34, .58, .1]), box('h', [0, .4, .1], [.36, .08, .12]),
    ...both(cyl('w', [.11, .52, -.01], [.026, .34, .026], { r: [0, 0, -.35] }), cyl('w', [.22, .66, -.01], [.02, .2, .02], { r: [0, 0, -.9] }), cyl('w', [.18, .6, -.01], [.02, .16, .02], { r: [0, 0, .5] }), oct('g', [.3, .74, -.01], [.03, .05, .03], { g: true })));
  on(B, 'foreR', ...staff(2.1, 'w'),
    tor('w', [0, HAND_Y, 1.15], [.17, .17, .17], { k: .13 }), oct('g', [0, HAND_Y, 1.15], [.1, .14, .1], { g: true }), cone('c', [0, HAND_Y + .1, 1.4], [.07, .24, .02], { r: [0, 0, .5] }), cone('c', [0, HAND_Y - .08, 1.4], [.07, .24, .02], { r: [0, 0, -.6] }),
    tor('b', [0, HAND_Y, .45], [.065, .065, .065], { k: .35 }), tor('b', [0, HAND_Y, .75], [.065, .065, .065], { k: .35 }));
  on(B, 'foreL', sph('g', [0, -.5, .2], [.08, .08, .08], { g: true }), cone('c', [.1, -.5, .2], [.07, .22, .02], { r: [0, 0, -1.1], g: true }), cone('c', [-.1, -.5, .2], [.07, .22, .02], { r: [0, 0, 1.1], g: true }));
  return finish('nature-guardian', 'staff', 2.47, B, [{ bone: 'foreR', base: [0, HAND_Y, .95], tip: [0, HAND_Y, 1.45] }]);
}

function warrior(): RigDef {
  const B = humanoid({ bulk: 1.38, aw: 1.45, lw: 1.18, headR: 1, skinHead: false, torso: 's', pelvis: 'b', arm: 's', fore: 'm', hand: 'm', leg: 'b', shin: 'b', boot: 'd' });
  on(B, 'spine',
    box('d', [0, .38, .19], [.1, .62, .03], { r: [0, 0, .7] }), box('d', [0, .38, .19], [.1, .62, .03], { r: [0, 0, -.7] }), box('m', [0, .38, .21], [.13, .13, .03]), oct('g', [0, .38, .23], [.04, .06, .015], { g: true }),
    box('d', [0, .08, 0], [.7, .16, .4]), box('b', [0, -.05, .18], [.34, .4, .04], { b: [.8, 1] }), sph('h', [0, .66, -.02], [.4, .12, .3]));
  onBoth(B, 'arm', cone('m', [-.12, .22, 0], [.08, .38, .08], { r: [0, 0, .5] }), cone('m', [-.2, .14, 0], [.06, .24, .06], { r: [0, 0, 1.0] }), oct('g', [-.26, .36, 0], [.04, .06, .04], { g: true }));
  on(B, 'hips', box('b', [0, -.2, .17], [.34, .4, .04], { b: [.8, 1] }), box('b', [0, -.2, -.17], [.34, .4, .04], { b: [.8, 1] }), box('m', [0, .09, .17], [.16, .12, .04]));
  on(B, 'head',
    sph('m', [0, .3, 0], [.24, .23, .24]), box('s', [0, .18, .15], [.24, .2, .12]), box('g', [-.08, .26, .205], [.06, .035, .02], { g: true }), box('g', [.08, .26, .205], [.06, .035, .02], { g: true }),
    box('h', [0, .06, .17], [.2, .2, .08]), box('m', [0, .5, 0], [.06, .1, .3], { t: [1, .5] }),
    ...both(cone('m', [.23, .42, 0], [.075, .46, .075], { r: [0, 0, -.9] }), cone('g', [.42, .6, 0], [.04, .14, .04], { r: [0, 0, -1.2], g: true })));
  on(B, 'foreR',
    cyl('w', [0, HAND_Y, .42], [.05, 1.02, .05], { r: [H, 0, 0] }), box('m', [0, HAND_Y, 1.0], [.5, .32, .32]), box('g', [.26, HAND_Y, 1.0], [.05, .26, .26], { g: true }), box('g', [-.26, HAND_Y, 1.0], [.05, .26, .26], { g: true }),
    cone('m', [0, HAND_Y + .2, 1.0], [.08, .16, .08]), cone('m', [0, HAND_Y - .2, 1.0], [.08, .16, .08], { r: [0, 0, PI] }));
  on(B, 'foreL', sph('g', [0, -.42, .08], [.12, .12, .12], { g: true }), oct('g', [.14, -.5, .12], [.05, .08, .05], { g: true }), oct('g', [-.14, -.36, .12], [.05, .08, .05], { g: true }));
  return finish('storm-warrior', 'smash', 2.31, B, [{ bone: 'foreR', base: [0, HAND_Y, .6], tip: [0, HAND_Y, 1.2] }]);
}

function meleeCreep(): RigDef {
  const B = humanoid({ bulk: 1.05, headR: 1, skinHead: false, torso: 'a', pelvis: 'b', arm: 'a', fore: 'm', hand: 'd', leg: 'b', shin: 'm', boot: 'd' });
  on(B, 'head', sph('m', [0, .27, 0], [.225, .235, .225]), box('d', [0, .27, .205], [.18, .04, .05]), box('s', [0, .17, .165], [.2, .15, .08]), box('t', [0, .52, -.04], [.06, .15, .34], { t: [1, .6] }));
  on(B, 'spine', box('c', [0, .2, .2], [.36, .5, .03]), box('d', [0, .52, 0], [.5, .06, .3]));
  onBoth(B, 'arm', sph('m', [0, .03, 0], [.16, .11, .15]));
  on(B, 'foreL', cyl('c', [.13, -.14, .1], [.3, .06, .3], { r: [0, 0, H] }), tor('m', [.17, -.14, .1], [.3, .3, .3], { r: [0, H, 0], k: .06 }), sph('m', [.19, -.14, .1], [.06, .06, .06]));
  on(B, 'foreR', ...blade(.6, .13, { thick: .04, guard: .26 }));
  return finish('melee-creep', 'blade', 2.28, B);
}

function rangedCreep(): RigDef {
  const B = humanoid({ bulk: .88, aw: .85, lw: .88, headR: 1, skinHead: true, torso: 'a', pelvis: 'b', arm: 'a', fore: 'd', hand: 's', leg: 'b', shin: 'd', boot: 'd' });
  on(B, 'head', sph('a', [0, .3, -.08], [.25, .26, .24]), cone('a', [0, .42, -.3], [.1, .4, .09], { r: [-1.1, 0, 0] }), box('d', [0, .385, .15], [.32, .05, .1]));
  on(B, 'spine', cone('b', [0, -.08, -.2], [.3, .8, .05], { r: [0, 0, PI] }), box('c', [0, .38, .18], [.3, .3, .03]), sph('b', [0, .6, 0], [.32, .12, .25]));
  on(B, 'foreR', ...staff(1.5, 'w'), sph('g', [0, HAND_Y, .66], [.11, .11, .11], { g: true }), tor('w', [0, HAND_Y, .62], [.11, .11, .11], { k: .15 }));
  return finish('ranged-creep', 'staff', 2.24, B, []);
}

function neutral(): RigDef {
  const B = humanoid({ bulk: 1.25, aw: 1.5, lw: 1.1, headR: 1, skinHead: false, torso: 's', pelvis: 'a', arm: 's', fore: 's', hand: 's', leg: 'a', shin: 's', boot: 'm' });
  on(B, 'head',
    sph('s', [0, .3, .05], [.3, .28, .3]), box('s', [0, .1, .2], [.32, .14, .22]), box('g', [-.1, .35, .3], [.08, .05, .03], { g: true }), box('g', [.1, .35, .3], [.08, .05, .03], { g: true }),
    ...both(cone('m', [.11, .17, .3], [.035, .2, .035]), cone('m', [.2, .52, 0], [.07, .36, .07], { r: [0, 0, -.6] }), cone('s', [.3, .35, -.05], [.09, .14, .03], { r: [0, 0, -H] })));
  on(B, 'spine', sph('a', [0, .5, -.16], [.3, .25, .25]), ...[0, 1, 2, 3].map(i => cone('c', [0, .62 - i * .12, -.34], [.05, .25 - i * .02, .05], { r: [-1, 0, 0] })));
  on(B, 'hips', cone('s', [0, -.12, -.4], [.12, .74, .12], { r: [-1.8, 0, 0] }), box('a', [0, -.15, .15], [.34, .3, .04]));
  onBoth(B, 'fore', cone('m', [.05, -.46, .04], [.03, .16, .03], { r: [PI, 0, 0] }), cone('m', [0, -.46, .06], [.03, .16, .03], { r: [PI, 0, 0] }), cone('m', [-.05, -.46, .04], [.03, .16, .03], { r: [PI, 0, 0] }));
  return finish('neutral', 'beast', 2.35, B);
}

function boss(): RigDef {
  const B = humanoid({ bulk: 1.5, aw: 1.6, lw: 1.3, headR: 1.15, skinHead: false, torso: 'a', pelvis: 'b', arm: 'a', fore: 'm', hand: 'm', leg: 'b', shin: 'm', boot: 'd' });
  on(B, 'head',
    sph('s', [0, .3, .02], [.28, .27, .27]), box('d', [0, .09, .2], [.3, .13, .16]), box('g', [-.1, .34, .25], [.09, .05, .03], { g: true }), box('g', [.1, .34, .25], [.09, .05, .03], { g: true }),
    ...both(cone('m', [.16, .54, 0], [.08, .5, .08], { r: [0, 0, -.5] }), cone('m', [.32, .74, 0], [.06, .36, .06], { r: [0, 0, -1.0] }), cone('m', [.08, .5, -.12], [.05, .3, .05], { r: [-.5, 0, -.15] })), cone('m', [0, .58, 0], [.06, .26, .06]));
  on(B, 'spine',
    oct('g', [0, .42, .2], [.09, .13, .04], { g: true }), box('m', [0, .12, .18], [.34, .12, .05]), sph('b', [0, .68, -.02], [.5, .14, .3]),
    ...[0, 1, 2].map(i => cone('m', [0, .6 - i * .16, -.32], [.07, .32 - i * .03, .07], { r: [-1.05, 0, 0] })));
  onBoth(B, 'arm', sph('b', [-.04, .06, 0], [.27, .2, .26]), cone('m', [-.14, .27, 0], [.09, .46, .09], { r: [0, 0, .45] }), cone('m', [-.28, .2, 0], [.07, .3, .07], { r: [0, 0, 1.0] }));
  on(B, 'hips', box('b', [0, -.22, .19], [.4, .46, .04], { b: [.8, 1] }), box('b', [0, -.22, -.19], [.4, .46, .04], { b: [.8, 1] }), box('m', [0, .09, .19], [.2, .13, .04]));
  on(B, 'foreR',
    cyl('w', [0, HAND_Y, .5], [.075, 1.2, .075], { r: [H, 0, 0] }), sph('w', [0, HAND_Y, 1.25], [.26, .26, .26]),
    ...[[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]].map(([x, y, z]) => cone('m', [x * .28, HAND_Y + y * .28, 1.25 + z * 0], [.07, .2, .07], { r: [y ? (y > 0 ? 0 : PI) : 0, 0, x ? (x > 0 ? -H : H) : 0] })),
    cone('m', [0, HAND_Y, 1.53], [.07, .2, .07], { r: [H, 0, 0] }), oct('g', [0, HAND_Y, 1.25], [.12, .12, .12], { g: true }));
  on(B, 'foreL', oct('g', [0, -.42, .1], [.1, .14, .1], { g: true }));
  return finish('boss', 'smash', 2.52, B, [{ bone: 'foreR', base: [0, HAND_Y, .7], tip: [0, HAND_Y, 1.55] }]);
}

const BUILD: Record<string, () => RigDef> = {
  'arcane-knight': knight, 'shadow-huntress': huntress, 'ember-mage': mage, 'nature-guardian': guardian, 'storm-warrior': warrior,
  'melee-creep': meleeCreep, 'ranged-creep': rangedCreep, neutral, boss,
};
const DEFS = new Map<string, RigDef>();
/** Rig definition for a model key ('arcane-knight', 'melee-creep', 'neutral', 'boss' ...), or null when there is none. */
export function rigDef(id: string): RigDef | null {
  let d = DEFS.get(id);
  if (!d && BUILD[id]) DEFS.set(id, d = BUILD[id]());
  return d || null;
}
export const RIG_IDS = Object.keys(BUILD);

/**
 * In-game height of each model in world units (the whole silhouette, hats and horns included).
 * Bulky heroes stand taller than the agile one, so the roster reads apart before the colors do.
 */
export const MODEL_HEIGHT: Record<string, number> = {
  'arcane-knight': 2.55, 'shadow-huntress': 2.35, 'ember-mage': 2.6, 'nature-guardian': 2.55, 'storm-warrior': 2.7,
  'melee-creep': 1.7, 'ranged-creep': 1.7, neutral: 2, boss: 5.6,
};
export const modelHeight = (key: string): number => MODEL_HEIGHT[key] ?? 2.5;

/* ------------------------------------------------------------------ palettes */

const C = new THREE.Color(), D = new THREE.Color();
export const mix = (a: number, b: number, t: number): number => C.setHex(a).lerp(D.setHex(b), t).getHex();
const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);
const darken = (c: number, t: number): number => mix(c, 0x000000, t);
const BASE: Palette = { s: 0xd8b898, d: 0x232838, w: 0x6b4a2a, h: 0x3b2a1a, m: 0xb8c4d8 };

const SPEC: Record<string, (hero: number) => Palette> = {
  'arcane-knight': g => ({ a: 0x4c6896, b: 0x34496e, c: 0xdde4f2, m: 0xc3cddd, h: 0x3b2a1a, g: lighten(g, .3) }),
  'shadow-huntress': g => ({ a: 0x4a3b78, b: 0x5e3f94, c: 0x9a6ae6, m: 0xb0b0c8, d: 0x241d38, s: 0xe0c8c0, h: 0xe6e6f0, g: lighten(g, .35) }),
  'ember-mage': g => ({ a: 0x8a3320, b: 0x5e2418, c: 0xe8a040, m: 0xc9a24a, h: 0xff8a3a, s: 0xe0b896, w: 0x4a2f1c, g: lighten(g, .3) }),
  'nature-guardian': g => ({ a: 0x2f7a48, b: 0x1f5232, c: 0x7fd06a, x: 0x6b4a2a, m: 0xc8b060, s: 0xc9a078, h: 0x4a3320, w: 0x7a5a36, g: lighten(g, .35) }),
  'storm-warrior': g => ({ a: 0x6a6a2a, b: 0x3a3320, c: 0xd8c050, m: 0xd6b040, s: 0xc89a78, h: 0xd8b858, g: lighten(g, .45) }),
};

/** Palette for a model: heroes use their own colors and glow in the hero color; creeps are tinted by team. */
export function paletteFor(id: string, heroColor: number, team: number): Palette {
  const t = team === 0 ? 0x3b9cff : team === 1 ? 0xff4a5a : 0xb28cff;
  const spec = SPEC[id];
  if (spec) return { ...BASE, ...spec(heroColor), t };
  if (id === 'neutral') return { ...BASE, a: 0x4a3868, b: 0x33264d, s: 0x7a6a9a, m: 0xe8e0cc, c: 0x9a8ab8, g: lighten(0xb28cff, .4), t };
  if (id === 'boss') return { ...BASE, a: 0x4a2040, b: 0x2c1428, s: 0x8a4a5a, m: 0xc9a24a, c: 0xe8e0cc, w: 0x3a2a24, g: lighten(0xff5ad0, .3), t };
  // melee-creep / ranged-creep: team-tinted soldiers
  return { ...BASE, a: darken(t, .45), b: darken(t, .65), c: t, m: 0x9aa0aa, g: lighten(t, .45), t };
}
