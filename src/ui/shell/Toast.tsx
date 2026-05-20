// Transient toast — a brief confirmation pinned to the bottom of the
// window (e.g. "Exported to Downloads"). Auto-clears via the toast store.

import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';

export function Toast() {
  const message = useToastStore((s) => s.message);
  const tone = useToastStore((s) => s.tone);

  if (!message) return null;

  return (
    <div className="app-toast" data-tone={tone} role="status" aria-live="polite">
      <Icon name={tone === 'error' ? 'alert' : 'check'} size={13} />
      <span>{message}</span>
    </div>
  );
}
