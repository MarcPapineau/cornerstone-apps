import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function Spinner({ className }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-faint', className)} />;
}

export function Loading({ label = 'Loading…', className }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-sm text-faint', className)}>
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({ error, className }) {
  const msg = (error && (error.message || String(error))) || 'Something went wrong.';
  return (
    <div className={cn('flex items-start gap-2 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', hint, icon: Icon = Inbox, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}>
      <Icon className="h-7 w-7 text-faint" />
      <p className="text-sm font-medium text-soft">{title}</p>
      {hint && <p className="max-w-sm text-xs text-faint">{hint}</p>}
    </div>
  );
}
