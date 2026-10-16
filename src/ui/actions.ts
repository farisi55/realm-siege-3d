import { $ } from './dom';
import { setPause } from './flow';
import { buy, sell, toggleShop } from './shop';
import { app } from '../game/state';
import { resetSet } from './menu';
import { ST } from '../game/storage';
/** Delegated click handling for every [data-act] element (replaces inline onclick handlers). */
export function bindActions(f: { play(): void; again(): void; toMenu(): void; showMenu(): void }): void {
  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const n = Number(t.dataset.n);
    switch (t.dataset.act) {
      case 'play': f.play(); break;
      case 'again': f.again(); break;
      case 'toMenu': f.toMenu(); break;
      case 'resume': setPause(false); break;
      case 'toggleShop': toggleShop(); break;
      case 'select': app.sel = n; f.showMenu(); break;
      case 'buy': buy(n); break;
      case 'sell': sell(n); break;
      case 'resetSet': resetSet(); f.showMenu(); break;
    }
  });
  $('zm').addEventListener('input', (e: Event) => ST.set('zoom', +(e.target as HTMLInputElement).value));
  $('bloomc').addEventListener('change', (e: Event) => { app.bloom = (e.target as HTMLInputElement).checked; ST.set('bloom', app.bloom); });
  $('fpsc').addEventListener('change', (e: Event) => ST.set('fps', (e.target as HTMLInputElement).checked));
}
