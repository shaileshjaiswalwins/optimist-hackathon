export type Toast = { id: string; text: string; tone: 'damage' | 'landed' };

export function HitToasts({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="hit-toasts" aria-live="assertive">
      {toasts.map(toast => <div key={toast.id} className={`hit-toast hit-toast-${toast.tone}`}>{toast.text}</div>)}
    </div>
  );
}
