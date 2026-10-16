import { app } from '../game/state';
import { $ } from './dom';
import { HR } from '../game/config';
import { hex } from '../game/util';
import { ST } from '../game/storage';
export function resetSet(){['zoom','fps','hero','bloom'].forEach(k=>{try{localStorage.removeItem('rs_'+k)}catch(e){}});app.sel=0;app.bloom=true;menu()}
export function menu(){$('heroes').innerHTML=HR.map((h,i)=>`<div class="hc${i===app.sel?' s':''}" data-act="select" data-n="${i}"><i style="background:${hex(h.c)}"></i><b>${h.n}</b><br>${h.role}<br>${h.at} - ${h.df}<br>HP ${h.hp}  DMG ${h.dmg}  SPD ${h.sp}</div>`).join('');
 $('hd').innerHTML=HR[app.sel].ab.map((a,i)=>`<div><b>${'QWER'[i]} ${a[0]}</b>: ${a[1]} (${a[3]}s, ${a[4]} mana)</div>`).join('');$('zm').value=ST.get('zoom',1);$('fpsc').checked=ST.get('fps',false);$('bloomc').checked=ST.get('bloom',true)}
