const STORAGE_KEY = 'jaldi-muted';

let muted = localStorage.getItem(STORAGE_KEY) === '1';
const listeners = new Set<(muted: boolean) => void>();

export const isMuted = () => muted;

export const setMuted = (value: boolean) => {
  muted = value;
  localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  listeners.forEach(listener => listener(muted));
};

export const onMuteChange = (listener: (muted: boolean) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
