import { useUi } from '../store';
import { play, toMenu } from '../../flow';
import { setPause } from '../commands';

export function Loading() {
  const { done, total } = useUi(s => s.loading);
  return (
    <div id="loading" className="ov">
      <h2 className="t">Realm Siege 3D</h2>
      <div className="pbar"><i style={{ width: `${(100 * done) / total}%` }} /></div>
      <small style={{ color: 'var(--mu)' }}>Loading models and world {done}/{total}</small>
    </div>
  );
}

export function Pause() {
  return (
    <div id="pz" className="ov">
      <h1>Paused</h1>
      <div className="row"><button className="p" onClick={() => setPause(false)}>Resume</button><button onClick={toMenu}>Main Menu</button></div>
    </div>
  );
}

export function End() {
  const win = useUi(s => s.result) === 'victory';
  return (
    <div id="end" className="ov">
      <h1 id="res" style={{ fontSize: 56, color: win ? '#ffd04a' : '#ff4a5a' }}>{win ? 'VICTORY' : 'DEFEAT'}</h1>
      <div className="row"><button className="p" onClick={play}>Play Again</button><button onClick={toMenu}>Main Menu</button></div>
    </div>
  );
}
