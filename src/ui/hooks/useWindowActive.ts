import { useEffect, useState } from 'react';

/**
 * True while the app window is focused and visible. When the user tabs away,
 * minimises, or hides the window, this flips to false so animation loops can
 * stop — a backgrounded app should cost no CPU/GPU.
 */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const update = () =>
      setActive(!document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus()));
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return active;
}
