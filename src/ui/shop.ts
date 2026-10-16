import { app, hooks } from '../game/state';
import { $ } from './dom';
import { IL, IT } from '../game/config';
import { rc } from '../game/sim/units';
export function toggleShop(){if(!app.G||app.G.over)return;$('shop').classList.toggle('hid');shopUI()}
export function shopUI(){const s=$('shop');if(s.classList.contains('hid'))return;
 s.innerHTML=`<div class="row" style="justify-content:space-between"><h2>Shop</h2><b id="sg" style="color:var(--gd)">${Math.floor(app.me.g)} gold</b><button data-act="toggleShop">Close (B)</button></div>
 <div class="cards">${IT.map((i,n)=>`<div class="card"><b>${i[0]}</b> <span style="color:var(--gd)">${i[1]}g</span><br><small>${Object.entries(i[2]).map(([k,v])=>'+'+v+' '+IL[k]).join(', ')}</small><br><button data-act="buy" data-n="${n}">Buy</button></div>`).join('')}</div>
 <h3>Inventory (${app.me.it.length}/6)</h3><div class="cards">${[0,1,2,3,4,5].map(n=>{const i=app.me.it[n];return `<div class="card">${i?`<b>${i.n}</b><br><button data-act="sell" data-n="${n}">Sell +${Math.floor(i.c*.6)}g</button>`:'<small>Empty slot</small>'}</div>`}).join('')}</div>`}
export function buy(n){const i=IT[n];if(app.me.g<i[1]||app.me.it.length>=6){hooks.ft(app.me.x,app.me.y-40,app.me.it.length>=6?'Inventory full':'Not enough gold','#ffe066');return}app.me.g-=i[1];app.me.it.push({n:i[0],c:i[1],b:i[2]});rc(app.me);shopUI()}
export function sell(n){const i=app.me.it.splice(n,1)[0];if(i){app.me.g+=Math.floor(i.c*.6);rc(app.me);shopUI()}}
