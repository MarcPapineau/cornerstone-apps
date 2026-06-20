import { ShieldAlert } from 'lucide-react';

const TEXT =
  'Educational / research resource only. NOT medical advice, diagnosis, treatment, or prescription. ' +
  'Vitalis does not diagnose, treat, cure, or prescribe. Always review with a qualified practitioner before any use.';

export function Disclaimer() {
  return (
    <footer className="border-t border-border-soft bg-warning-soft/40 px-6 py-2.5">
      <div className="flex items-start gap-2 text-2xs leading-relaxed text-soft">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>{TEXT}</span>
      </div>
    </footer>
  );
}
