import { app } from '../game/state';
import { $ } from './dom';
export function setPause(v){if(!app.G||app.G.over)return;app.G.pause=v;$('pz').classList.toggle('hid',!v)}
export function finish(w){app.G.over=true;app.G.win=w;const win=w===0;$('res').textContent=win?'VICTORY':'DEFEAT';$('res').style.color=win?'#ffd04a':'#ff4a5a';$('end').classList.remove('hid')}
