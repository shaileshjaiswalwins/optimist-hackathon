import { useEffect, useReducer } from 'react';
import { vehicleTuning, vehicleTuningFields } from './vehiclePhysics';

export function VehicleDebugPanel() {
  const [open, toggle] = useReducer(value => !value, false);
  const [, refresh] = useReducer(value => value + 1, 0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '`') return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;
  return <aside className="vehicle-debug-panel" aria-label="Vehicle physics tuning">
    <strong>V2 vehicle tuning</strong><small>Press ` to close</small>
    {vehicleTuningFields.map(field => <label key={field.key}>
      <span>{field.label}: {vehicleTuning[field.key]}</span>
      <input type="range" min={field.min} max={field.max} step={field.step} value={vehicleTuning[field.key]}
        onChange={event => { vehicleTuning[field.key] = Number(event.target.value); refresh(); }} />
    </label>)}
  </aside>;
}
