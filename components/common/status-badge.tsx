type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneClassName: Record<StatusTone, string> = {
  neutral: 'border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] text-[color:var(--text-muted)]',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 dark:text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200 dark:text-amber-300',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-200 dark:text-rose-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-200 dark:text-sky-300',
};

export function StatusBadge({
  label,
  tone = 'neutral',
  pulse = false,
}: {
  label: string;
  tone?: StatusTone;
  pulse?: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.18em]',
        toneClassName[tone],
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'h-1.5 w-1.5 rounded-full bg-current opacity-80',
          pulse ? 'animate-pulse' : '',
        ].join(' ')}
      />
      {label}
    </span>
  );
}
