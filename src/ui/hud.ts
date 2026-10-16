import { $ } from './dom';
import { app } from '../game/state';
import { TCC } from '../game/config';
import { hex } from '../game/util';
export function feed(m,c){const d=document.createElement('div');d.textContent=m;d.style.color=c;$('feed').prepend(d);setTimeout(()=>d.remove(),4500)}
export function hud(){const h=app.me,tc=t=>app.all.filter(o=>o.k==='tower'&&o.team===t).length;
 $('sb').textContent=app.G.k[0]+' : '+app.G.k[1];$('tm').textContent=Math.floor(app.G.t/60)+':'+String(Math.floor(app.G.t%60)).padStart(2,'0');$('ob').textContent='Towers '+tc(0)+' vs '+tc(1);
 $('lv').textContent=h.def.n+'  Lv '+h.lv;$('hpf').style.width=100*h.hp/h.max+'%';$('mpf').style.width=100*h.mp/h.mmax+'%';$('xpf').style.width=100*h.xp/(90+h.lv*70)+'%';
 $('hpt').textContent=Math.ceil(h.hp)+' / '+Math.round(h.max);$('gd').textContent=Math.floor(h.g)+' gold';
 for(let i=0;i<4;i++){const c=h.acd[i];$('c'+i).textContent=c>0?Math.ceil(c):i===3&&h.lv<3?'Lv3':''}
 for(let i=0;i<6;i++){const it=h.it[i],e=$('s'+i);e.textContent=it?it.n.split(' ').map(w=>w[0]).join(''):'';e.title=it?it.n:''}
 $('cd').textContent=app.G.st==='prep'?'Match begins in '+Math.ceil(10-app.G.t):h.dead?'Respawn in '+Math.ceil(h.rs):'';
 $('fps').textContent=$('fpsc').checked?Math.round(app.fps)+' FPS':'';
 const sg=$('sg');if(sg)sg.textContent=Math.floor(h.g)+' gold';
 if(!$('score').classList.contains('hid'))$('score').innerHTML='<table>'+[0,1].map(t=>app.all.filter(o=>o.k==='hero'&&o.team===t).map(o=>`<tr style="color:${TCC[t]}"><td>${o.def.n}${o===app.me?' (You)':''}<td>Lv ${o.lv}<td>${o.kl}/${o.dt}</tr>`).join('')).join('')+'</table>'}
export function buildHud(){const d=app.me.def;$('pic').style.background=hex(d.c);
 $('abs').innerHTML=d.ab.map((a,i)=>`<div class="ab" id="a${i}" title="${a[0]}: ${a[1]} (${a[3]}s, ${a[4]} mana)"><b>${'QWER'[i]}</b><span>${a[0]}</span><u id="c${i}"></u></div>`).join('');
 $('its').innerHTML=[0,1,2,3,4,5].map(i=>`<div class="sl" id="s${i}"></div>`).join('');$('hud').classList.remove('hid');$('shop').classList.add('hid');$('pz').classList.add('hid')}
