import { createRoot } from 'react-dom/client';
import { App } from './App';

export function mount(el: HTMLElement = document.getElementById('root')!): void {
  createRoot(el).render(<App />);
  // Space / Enter are game keys: buttons must not keep keyboard focus after a click.
  document.addEventListener('click', e => (e.target as HTMLElement).closest?.('button')?.blur());
}
