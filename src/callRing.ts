import { createRoot, createSignal } from "solid-js";

export const CALL_RING_SOUND_STORAGE_KEY = "space.call-ring.sound";
const readSound = () => {
  try { return localStorage.getItem(CALL_RING_SOUND_STORAGE_KEY) !== "false"; }
  catch { return true; }
};
const state = createRoot(() => {
  const [ringSoundEnabled, setRingSoundEnabled] = createSignal(readSound());
  const setCallRingSoundEnabled = (enabled: boolean) => {
    setRingSoundEnabled(enabled);
    try { localStorage.setItem(CALL_RING_SOUND_STORAGE_KEY, String(enabled)); } catch { /* live preference remains available */ }
  };
  return { ringSoundEnabled, setCallRingSoundEnabled };
});
export const { ringSoundEnabled, setCallRingSoundEnabled } = state;
