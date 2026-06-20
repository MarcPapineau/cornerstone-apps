import { cn } from '../../lib/utils.js';

export function Label({ className, ...props }) {
  return <label className={cn('mb-1.5 block text-xs font-medium text-soft', className)} {...props} />;
}

const inputBase =
  'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-faint ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }) {
  return <input className={cn(inputBase, 'h-9', className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(inputBase, 'h-9 appearance-none bg-card pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(inputBase, 'min-h-[80px] py-2', className)} {...props} />;
}

export function FieldRow({ className, ...props }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)} {...props} />;
}

export function FormField({ label, hint, children, className }) {
  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <p className="mt-1 text-2xs text-faint">{hint}</p>}
    </div>
  );
}
