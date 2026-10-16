import { HeroDef, ItemDef } from './types';
export const W=3200;
export const TCOL=[0x3b9cff,0xff4a5a,0xb28cff];
export const TCC=['#6fb4ff','#ff7a86','#c9a0ff'];
export const LN=[[[400,2800],[400,400],[2800,400]],[[400,2800],[1600,1600],[2800,400]],[[400,2800],[2800,2800],[2800,400]]];
export const TW=[[[400,1900],[400,1000]],[[900,2300],[1250,1950]],[[1000,2800],[1900,2800]]];
export const CAMP=[[800,1500],[1500,800],[2400,1700],[1700,2400]];
export const BASE=[[360,2840],[2840,360]];
export const SP=[[470,2730],[2730,470]];
export const path=(t,L)=>t?LN[L].slice().reverse():LN[L];
export const HR:HeroDef[]=[
{n:'Arcane Knight',role:'Strength / Tank',at:'Melee',df:'Easy',c:0x6aa8ff,hp:720,mp:240,dmg:54,rng:120,as:1000,ar:9,mr:15,sp:235,g:[100,25,5],ab:[
['Arcane Strike','Arcane bolt hits the first enemy.','bolt',3,40,95,520],['Shield Wall','Heals you and nearby allies.','heal',12,70,180,260],['Ground Slam','Damages and stuns enemies around you.','aoe',10,80,110,230,1300],['Meteor Prison','Meteor at cursor: heavy damage, long stun.','tgt',50,150,260,260,2200]]},
{n:'Shadow Huntress',role:'Agility / Assassin',at:'Ranged',df:'Hard',c:0xb06bff,hp:520,mp:260,dmg:60,rng:380,as:850,ar:4,mr:10,sp:260,g:[70,28,6],ab:[
['Shadow Dash','Dash toward cursor, strike on landing.','dash',7,50,70,340],['Poison Arrow','Long-range venom bolt.','bolt',4,45,120,700],['Smoke Veil','+60% damage and faster for 5s.','buff',16,60,60,5],['Death Mark','Mark at cursor: massive burst.','tgt',45,140,420,130]]},
{n:'Ember Mage',role:'Intelligence / Mage',at:'Ranged',df:'Medium',c:0xff8a3a,hp:500,mp:380,dmg:44,rng:420,as:1000,ar:3,mr:12,sp:240,g:[65,45,4],ab:[
['Fire Bolt','Fast fire projectile.','bolt',3,45,130,650],['Flame Wave','Flames burst around you.','aoe',8,70,150,260],['Burning Zone','Fire pool at cursor.','tgt',12,90,160,200],['Inferno Storm','Huge storm at cursor.','tgt',50,160,380,330]]},
{n:'Nature Guardian',role:'Support',at:'Ranged',df:'Medium',c:0x4ee08a,hp:560,mp:340,dmg:40,rng:380,as:1000,ar:5,mr:14,sp:240,g:[75,40,4],ab:[
['Healing Seed','Heals nearby allies.','heal',8,60,150,320],['Root Trap','Roots enemies at cursor.','tgt',12,70,70,170,1800],['Nature Barrier','Strong heal around you.','heal',16,90,260,260],['Forest Rebirth','Massive team heal.','heal',60,160,480,600]]},
{n:'Storm Warrior',role:'Fighter',at:'Melee',df:'Medium',c:0xffe14a,hp:640,mp:260,dmg:58,rng:125,as:900,ar:7,mr:12,sp:245,g:[90,28,6],ab:[
['Lightning Punch','Short-range lightning bolt.','bolt',3,40,100,300],['Static Field','Shocks enemies around you.','aoe',9,70,120,250],['Thunder Charge','Charge to cursor, shock on landing.','dash',10,60,110,400],['Storm Rage','+80% damage and faster for 8s.','buff',50,100,80,8]]}];
export const IL={d:'Damage',as:'Attack Speed %',ar:'Armor',mr:'Magic Resist',hp:'Health',mp:'Mana',sp:'Move Speed',ls:'% Lifesteal',ap:'Ability Power %'};
export const IT:ItemDef[]=[['Iron Blade',300,{d:25}],['Swift Gloves',350,{as:30}],['Bark Mail',300,{ar:8}],['Ward Cloak',300,{mr:12}],['Vital Heart',400,{hp:280}],['Mana Crystal',300,{mp:220}],['Wind Boots',350,{sp:40}],['Blood Fang',450,{ls:12}],['Arcane Tome',350,{ap:30}],['War Axe',750,{d:55}],['Iron Plate',650,{ar:18}],['Sage Crown',850,{ap:45,mp:150}]];
export const CT={melee:{hp:320,dmg:22,rng:75,as:1000,ar:2,sp:125,r:12,g:22,xp:42},ranged:{hp:210,dmg:28,rng:260,as:1100,ar:0,sp:125,r:10,g:26,xp:46},siege:{hp:600,dmg:60,rng:340,as:2000,ar:5,sp:105,r:16,g:48,xp:75}};
export const K=1/20;
