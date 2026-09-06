import { useEffect, useReducer, useState } from 'react';
import { VEHICLE_TUNINGS, vehicleTuningFields } from './vehiclePhysics';

export function VehicleDebugPanel() {
  const [open, toggle] = useReducer(value => !value, false);
  const [, refresh] = useReducer(value => value + 1, 0);
  const [vehicleType, setVehicleType] = useState<keyof typeof VEHICLE_TUNINGS>('auto');

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
  const tuning = VEHICLE_TUNINGS[vehicleType];
  return <aside className="vehicle-debug-panel" aria-label="Vehicle physics tuning">
    <strong>V2 vehicle tuning</strong><small>Press ` to close</small>
    <label>
      <span>Vehicle</span>
      <select value={vehicleType} onChange={event => setVehicleType(event.target.value as keyof typeof VEHICLE_TUNINGS)}>
        {Object.keys(VEHICLE_TUNINGS).map(key => <option key={key} value={key}>{key}</option>)}
      </select>
    </label>
    {vehicleTuningFields.map(field => <label key={field.key}>
      <span>{field.label}: {tuning[field.key]}</span>
      <input type="range" min={field.min} max={field.max} step={field.step} value={tuning[field.key]}
        onChange={event => { tuning[field.key] = Number(event.target.value); refresh(); }} />
    </label>)}
  </aside>;
}
