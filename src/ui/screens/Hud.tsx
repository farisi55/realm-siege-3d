import { useEffect, useRef } from 'react';
import { HR } from '../../game/config';
import { hex } from '../../game/util';
import { useUi } from '../store';
import { minimap } from '../minimap';
import { toggleShop } from '../commands';

const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function Minimap() {
  const big = useUi(s => s.minimapBig), ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { minimap.canvas = ref.current; return () => { minimap.canvas = null; }; }, []);
  return <canvas id="mm" ref={ref} className={big ? 'big' : ''} width={180} height={180} />;
}

export function Hud() {
  const h = useUi(s => s.hud), feed = useUi(s => s.feed), showFps = useUi(s => s.showFps), fps = useUi(s => s.fps);
  if (!h) return null;
  const hero = HR[h.hero];
  return (
    <div id="hud">
      <div id="top">
        <span id="sb" className="t">{h.kills[0]} : {h.kills[1]}</span><span id="tm">{clock(h.time)}</span><span id="ob">Towers {h.towers[0]} vs {h.towers[1]}</span>
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
        <div>
          <b id="lv">{hero.n} Lv {h.lv}</b>
          <div className="b"><i style={{ background: '#3ccf6a', width: pct(h.hp / h.max) }} /><u>{Math.ceil(h.hp)} / {Math.round(h.max)}</u></div>
          <div className="b"><i style={{ background: '#2f7bff', width: pct(h.mp / h.mmax) }} /></div>
          <div className="b s"><i style={{ background: '#b86bff', width: pct(h.xp / h.xpNext) }} /></div>
        </div>
        <div id="abs">
          {hero.ab.map((a, i) => {
            const c = h.cds[i], tag = c > 0 ? String(Math.ceil(c)) : i === 3 && h.lv < 3 ? 'Lv3' : '';
            return <div className="ab" key={a[0]} title={`${a[0]}: ${a[1]} (${a[3]}s, ${a[4]} mana)`}><b>{'QWER'[i]}</b><span>{a[0]}</span>{tag && <u>{tag}</u>}</div>;
          })}
        </div>
        <div id="its">{h.items.map((n, i) => <div className="sl" key={i} title={n ?? ''}>{n ? n.split(' ').map(w => w[0]).join('') : ''}</div>)}</div>
        <div><b id="gd" style={{ color: 'var(--gd)' }}>{h.gold} gold</b><br /><button onClick={toggleShop}>Shop (B)</button></div>
      </div>
    </div>
  );
}
