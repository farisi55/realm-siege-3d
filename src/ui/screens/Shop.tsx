import { app } from '../../game/state';
import { IL, IT } from '../../game/config';
import { useUi } from '../store';
import { buy, sell, toggleShop } from '../commands';

export function Shop() {
  const gold = useUi(s => s.hud?.gold ?? 0);
  useUi(s => s.rev); // re-render after buy / sell
  const owned = app.me.it;
  return (
    <div id="shop">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Shop</h2><b style={{ color: 'var(--gd)' }}>{gold} gold</b><button onClick={toggleShop}>Close (B)</button>
      </div>
      <div className="cards">
        {IT.map((it, n) => (
          <div className="card" key={it[0]}>
            <b>{it[0]}</b> <span style={{ color: 'var(--gd)' }}>{it[1]}g</span><br />
            <small>{Object.entries(it[2]).map(([k, v]) => `+${v} ${IL[k]}`).join(', ')}</small><br />
            <button onClick={() => buy(n)}>Buy</button>
          </div>
        ))}
      </div>
      <h3>Inventory ({owned.length}/6)</h3>
      <div className="cards">
        {[0, 1, 2, 3, 4, 5].map(n => {
          const it = owned[n];
          return <div className="card" key={n}>{it ? <><b>{it.n}</b><br /><button onClick={() => sell(n)}>Sell +{Math.floor(it.c * .6)}g</button></> : <small>Empty slot</small>}</div>;
        })}
      </div>
    </div>
  );
}
