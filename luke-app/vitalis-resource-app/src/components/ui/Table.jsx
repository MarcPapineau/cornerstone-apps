import { cn } from '../../lib/utils.js';

export function Table({ className, ...props }) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }) {
  return <thead className={cn('border-b border-border-soft', className)} {...props} />;
}

export function TBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TR({ className, ...props }) {
  return <tr className={cn('border-b border-border-soft transition-colors hover:bg-muted/50', className)} {...props} />;
}

export function TH({ className, ...props }) {
  return (
    <th
      className={cn('h-9 px-3 text-left align-middle text-2xs font-semibold uppercase tracking-wide text-faint', className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }) {
  return <td className={cn('px-3 py-2.5 align-middle text-soft', className)} {...props} />;
}
