import { useUi } from './store';
import { MainMenu } from './screens/MainMenu';
import { Hud } from './screens/Hud';
import { Shop } from './screens/Shop';
import { Loading, Pause, End } from './screens/Overlays';

export function App() {
  const phase = useUi(s => s.phase), paused = useUi(s => s.paused), result = useUi(s => s.result), shop = useUi(s => s.shop);
  const playing = phase === 'play';
  return (
    <>
      {playing && <Hud />}
      {playing && shop && !result && <Shop />}
      {phase === 'menu' && <MainMenu />}
      {playing && paused && <Pause />}
      {playing && result && <End />}
      {phase === 'loading' && <Loading />}
    </>
  );
}
