import './style.css';
import { mount } from './ui/mount';
import { boot, frame } from './flow';
import { app } from './game/state';
import { step } from './game/match';
import { assets } from './assets/AssetManager';
import { fxDebug } from './render/vfx';
import { cm, rd, sn } from './render/scene';
import { environment } from './render/environment';
import { governor, setQuality } from './render/quality';
import { postInfo } from './render/post';

mount();
boot().catch(console.error);

let last = performance.now();
function loop(t: number): void {
  requestAnimationFrame(loop);
  frame(Math.min((t - last) / 1000, .05) || 0);
  last = t;
}
requestAnimationFrame(loop);

// Debug hook for automated browser checks: open the page with ?debug to fast-forward the game from the console.
if (new URLSearchParams(location.search).has('debug')) (window as any).__realm = { app, frame, step, assets, fx: fxDebug, rd, sn, cm, env: environment, gov: governor, setQuality, post: postInfo };
