import { HR } from '../../game/config';
import { hex } from '../../game/util';
import { useUi } from '../store';
import { setAudioMuted, setAudioVolume, setGraphics, setSetting } from '../commands';
import { play, selectHero, resetAndShowMenu } from '../../flow';

export function MainMenu() {
  const sel = useUi(s => s.sel), zoom = useUi(s => s.zoom), showFps = useUi(s => s.showFps), bloom = useUi(s => s.bloom), quality = useUi(s => s.quality), audio = useUi(s => s.audio);
  return (
    <div id="menu" className="ov">
      <h1 style={{ fontSize: 46, color: 'var(--gd)' }}>Moba DOTA</h1>
      <div className="t" style={{ color: 'var(--mu)' }}>Choose your hero, then destroy the enemy core</div>
      <div id="heroes" className="row">
        {HR.map((h, i) => (
          <div key={h.n} className={'hc' + (i === sel ? ' s' : '')} onClick={() => selectHero(i)}>
            <i style={{ background: hex(h.c) }} /><b>{h.n}</b><br />{h.role}<br />{h.at} - {h.df}<br />HP {h.hp} DMG {h.dmg} SPD {h.sp}
          </div>
        ))}
      </div>
      <div id="hd" style={{ maxWidth: 720, color: 'var(--mu)', lineHeight: 1.6 }}>
        {HR[sel].ab.map((a, i) => <div key={a[0]}><b>{'QWER'[i]} {a[0]}</b>: {a[1]} ({a[3]}s, {a[4]} mana)</div>)}
      </div>
      <button className="p" style={{ fontSize: 18, padding: '10px 40px' }} onClick={play}>Play</button>
      <details>
        <summary>Instructions</summary>
        Arrow keys or right click: move. Left click: attack an enemy or move. Q W E R: abilities (R unlocks at level 3). Space: center camera. B: shop. Tab: scoreboard. M: minimap size. Esc: pause. Mouse wheel: zoom. Middle-mouse drag: rotate camera. Screen edge: scroll camera. Touch: tap the battlefield to move or attack, tap Q W E R to cast, use the Attack button for the nearest enemy, two fingers rotate and pinch-zoom. Destroy towers with your creeps, then the enemy core.
      </details>
      <details>
        <summary>Settings</summary>
        <div className="row" style={{ padding: '6px 0' }}>
          <label>Camera zoom <input type="range" min=".6" max="1.6" step=".05" value={zoom} onChange={e => setSetting('zoom', +e.target.value)} /></label>
          <label><input type="checkbox" checked={showFps} onChange={e => setSetting('showFps', e.target.checked)} /> Show FPS</label>
          <label><input type="checkbox" checked={bloom} onChange={e => setSetting('bloom', e.target.checked)} /> Bloom</label>
          <label>Graphics{' '}
            <select value={quality} onChange={e => setGraphics(e.target.value)}>
              <option value="auto">Auto (keeps 60 FPS)</option><option value="3">High</option><option value="2">Medium</option><option value="1">Low</option><option value="0">Minimum</option>
            </select>
          </label>
          <button onClick={resetAndShowMenu}>Reset saved settings</button>
        </div>
        <div className="row" style={{ padding: '6px 0' }}>
          <label>Volume <input type="range" min="0" max="1" step=".05" value={audio.master} onChange={e => setAudioVolume('master', +e.target.value)} /></label>
          <label>SFX <input type="range" min="0" max="1" step=".05" value={audio.sfx} onChange={e => setAudioVolume('sfx', +e.target.value)} /></label>
          <label>Music <input type="range" min="0" max="1" step=".05" value={audio.music} onChange={e => setAudioVolume('music', +e.target.value)} /></label>
          <label>Ambient <input type="range" min="0" max="1" step=".05" value={audio.ambient} onChange={e => setAudioVolume('ambient', +e.target.value)} /></label>
          <label>UI <input type="range" min="0" max="1" step=".05" value={audio.ui} onChange={e => setAudioVolume('ui', +e.target.value)} /></label>
          <label><input type="checkbox" checked={audio.muted} onChange={e => setAudioMuted(e.target.checked)} /> Mute audio</label>
        </div>
      </details>
      <small style={{ color: 'var(--mu)' }}>Credits: original prototype built with Three.js and React. Models are procedural placeholders unless GLB files are provided.</small>
    </div>
  );
}
