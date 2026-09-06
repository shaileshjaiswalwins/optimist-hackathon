import { PointerEvent as ReactPointerEvent, useRef } from 'react';

type Props = {
  onSteer: (value: number) => void;
};

// Angle-based drag: we track pointer angle around the wheel center and derive
// steering from how far it's rotated from the grab angle, not raw x position,
// so a small flick near the rim doesn't spike to full lock.
export function SteeringWheel({ onSteer }: Props) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ pointerId: number; startAngle: number } | null>(null);
  const rotation = useRef(0);

  const angleAt = (clientX: number, clientY: number) => {
    const rect = wheelRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  };

  const applyRotation = (deg: number) => {
    rotation.current = Math.max(-90, Math.min(90, deg));
    if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotation.current}deg)`;
    onSteer(rotation.current / 90);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    wheelRef.current?.setPointerCapture(event.pointerId);
    dragState.current = { pointerId: event.pointerId, startAngle: angleAt(event.clientX, event.clientY) - (rotation.current * Math.PI) / 180 };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    const current = angleAt(event.clientX, event.clientY);
    const deltaDeg = ((current - dragState.current.startAngle) * 180) / Math.PI;
    applyRotation(deltaDeg);
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
    dragState.current = null;
    applyRotation(0);
  };

  return (
    <div className="steering-wheel-mount">
      <div
        ref={wheelRef}
        className="steering-wheel"
        role="slider"
        aria-label="Steering"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={rotation.current / 90}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <div className="steering-wheel-ring">
          <span className="steering-wheel-spoke steering-wheel-spoke-v" />
          <span className="steering-wheel-spoke steering-wheel-spoke-h" />
          <span className="steering-wheel-hub" />
        </div>
      </div>
    </div>
  );
}
