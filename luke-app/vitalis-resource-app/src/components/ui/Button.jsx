import { cn } from '../../lib/utils.js';

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  outline: 'border border-border bg-card text-foreground hover:bg-muted',
  subtle: 'bg-muted text-foreground hover:bg-muted/70',
  ghost: 'text-soft hover:bg-muted hover:text-foreground',
  danger: 'bg-danger text-danger-foreground hover:bg-danger/90 shadow-sm',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-sm',
  icon: 'h-9 w-9',
};

export function Button({ className, variant = 'primary', size = 'md', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
