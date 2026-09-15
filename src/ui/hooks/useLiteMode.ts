import { useBrainModesStore } from '@core/store/brainModesStore';
import { useLowEndDevice } from './useLowEndDevice';

/**
 * Whether the app is in Lite mode: no WebGL scene unless the user asks for one.
 * The stored preference decides — 'on' and 'off' are explicit user choices, and
 * 'auto' turns Lite on only for weak hardware (see useLowEndDevice). One hook so
 * the Brain workspace, the title-bar toggle and Memory mode can never disagree
 * about which mode the app is in.
 */
export function useLiteMode(): boolean {
  const autoLowEnd = useLowEndDevice();
  const litePref = useBrainModesStore((s) => s.lite);
  return litePref === 'on' || (litePref === 'auto' && autoLowEnd);
}
