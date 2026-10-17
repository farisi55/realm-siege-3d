import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react';
import { HR } from '../../game/config';
import { hex } from '../../game/util';
import { ST } from '../../game/storage';
import { useUi } from '../store';
import { minimap } from '../minimap';
import { setPause, toggleShop } from '../commands';
import { tryAttack, tryCast } from '../../render/input';

const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
/** Pointerdown serves mouse and touch; the click fallback only handles keyboard/assistive activation (detail === 0), so a tap can never cast twice. */
const press = (fn: () => void) => (e: RPointerEvent) => { e.preventDefault(); fn(); };
const keyOnly = (fn: () => void) => (e: RMouseEvent) => { if (e.detail === 0) fn(); };

function Minimap() {
  const big = useUi(s => s.minimapBig), ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { minimap.canvas = ref.current; return () => { minimap.canvas = null; }; }, []);
  return <canvas id="mm" ref={ref} className={big ? 'big' : ''} width={180} height={180} />;
}

/** Portrait phones: a small, dismissible hint. It never blocks play and stays gone once dismissed. */
function RotationHint() {
  const [off, setOff] = useState(() => ST.get('rotHint', 0) === 1);
  if (off) return null;
  return <div id="rot"><span>Landscape shows the battlefield best</span><button type="button" aria-label="Dismiss rotation hint" onClick={() => { ST.set('rotHint', 1); setOff(true); }}>✕</button></div>;
}

export function Hud() {
  const h = useUi(s => s.hud), feed = useUi(s => s.feed), showFps = useUi(s => s.showFps), fps = useUi(s => s.fps);
  if (!h) return null;
  const hero = HR[h.hero], dead = h.hp <= 0;
  return (
    <div id="hud">
      <div id="top">
        <span id="sb" className="t">{h.kills[0]} : {h.kills[1]}</span><span id="tm">{clock(h.time)}</span><span id="ob">Towers {h.towers[0]} vs {h.towers[1]}</span>
        <button type="button" id="pause" aria-label="Pause" onClick={() => setPause(true)}>❚❚</button>
      </div>
      {h.countdown && <div id="cd" className="t">{h.countdown}</div>}
      <Minimap />
      <div id="feed">{feed.map(f => <div key={f.id} style={{ color: f.color }}>{f.msg}</div>)}</div>
      {showFps && <div id="fps">{Math.round(fps)} FPS</div>}
      {h.score && (
        <div id="score"><table><tbody>
          {h.score.map((r, i) => (
            <tr key={i} style={{ color: r.team ? '#ff7a86' : '#6fb4ff' }}><td>{r.name}{r.me ? ' (You)' : ''}</td><td>Lv {r.lv}</td><td>{r.kills}/{r.deaths}</td></tr>
          ))}
        </tbody></table></div>
      )}
      <div id="bot">
        <div id="pic" style={{ background: hex(hero.c) }} />
        <div id="hstats">
          <b id="lv">{hero.n} Lv {h.lv}</b>
          <div className="b"><i style={{ background: '#3ccf6a', width: pct(h.hp / h.max) }} /><u>{Math.ceil(h.hp)} / {Math.round(h.max)}</u></div>
          <div className="b"><i style={{ background: '#2f7bff', width: pct(h.mp / h.mmax) }} /></div>
          <div className="b s"><i style={{ background: '#b86bff', width: pct(h.xp / h.xpNext) }} /></div>
        </div>
        <div id="abs">
          {hero.ab.map((a, i) => {
            const c = h.cds[i], locked = i === 3 && h.lv < 3, noMana = h.mp < a[4];
            const tag = c > 0 ? String(Math.ceil(c)) : locked ? 'Lv3' : '';
            const cls = 'ab' + (dead ? ' dead' : c > 0 ? ' cd' : locked ? ' locked' : noMana ? ' nomana' : ' ready');
            return <button type="button" className={cls} key={a[0]} title={`${a[0]}: ${a[1]} (${a[3]}s, ${a[4]} mana)`}
              onPointerDown={press(() => tryCast(i))} onClick={keyOnly(() => tryCast(i))} onContextMenu={e => e.preventDefault()}>
              <b>{'QWER'[i]}</b><span>{a[0]}</span>{tag && <u>{tag}</u>}
            </button>;
          })}
        </div>
        <div id="its">{h.items.map((n, i) => <div className="sl" key={i} title={n ?? ''}>{n ? n.split(' ').map(w => w[0]).join('') : ''}</div>)}</div>
        <button type="button" id="atk" aria-label="Attack" title="Attack the nearest enemy"
          onPointerDown={press(tryAttack)} onClick={keyOnly(tryAttack)} onContextMenu={e => e.preventDefault()}><b>⚔</b></button>
        <div id="hshop"><b id="gd" style={{ color: 'var(--gd)' }}>{h.gold} gold</b><button type="button" id="shopb" onClick={toggleShop}>Shop (B)</button></div>
      </div>
      <RotationHint />
    </div>
  );
}
