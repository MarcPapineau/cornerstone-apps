import { cn } from '../../lib/utils.js';

const TONES = {
  neutral: 'bg-neutral-soft text-soft border-border-soft',
  accent: 'bg-accent-soft text-primary border-primary/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  outline: 'bg-transparent text-soft border-border',
};

export function Badge({ className, tone = 'neutral', ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-none',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
