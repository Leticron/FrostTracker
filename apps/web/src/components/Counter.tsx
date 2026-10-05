import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Large +/- control for use at the table. Holding a button repeats (after a short delay),
 * so big changes don't need dozens of taps.
 */
export function Counter({
  label,
  value,
  onChange,
  disabled,
  hint,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (delta: number) => void;
  disabled?: boolean;
  hint?: ReactNode;
  min?: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
      <RepeatButton
        label={`${label} −1`}
        disabled={disabled || value <= min}
        onStep={() => onChange(-1)}
      >
        −
      </RepeatButton>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
        <div className="text-2xl font-semibold tabular-nums" aria-live="polite">
          {value}
        </div>
        {hint && <div className="truncate text-xs text-slate-500">{hint}</div>}
      </div>
      <RepeatButton label={`${label} +1`} disabled={disabled} onStep={() => onChange(1)}>
        +
      </RepeatButton>
    </div>
  );
}

function RepeatButton({
  children,
  label,
  disabled,
  onStep,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  onStep: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  });
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);
  const start = () => {
    stepRef.current();
    const repeat = (delay: number) => {
      timer.current = window.setTimeout(() => {
        stepRef.current();
        repeat(Math.max(60, delay * 0.8));
      }, delay);
    };
    repeat(450);
  };
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStep();
        }
      }}
      className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-xl bg-slate-100 text-2xl font-semibold select-none active:bg-sky-200 disabled:opacity-40 dark:bg-slate-800 dark:active:bg-sky-900"
    >
      {children}
    </button>
  );
}
