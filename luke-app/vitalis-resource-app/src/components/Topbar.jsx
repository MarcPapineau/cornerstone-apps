import { Menu } from 'lucide-react';
import { GateStatusBar } from './GateStatusBar.jsx';
import { RoleSwitcher } from './RoleSwitcher.jsx';
import { Badge } from './ui/Badge.jsx';

export function Topbar({ onMenu }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-soft bg-card/90 px-4 py-2 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="-ml-1 rounded-md p-1.5 text-soft hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <GateStatusBar />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge tone="warning" className="hidden max-w-[420px] truncate uppercase tracking-wide md:inline-flex">
          This is a simulation, for Research purposes. Not actual representation.
        </Badge>
        <RoleSwitcher />
        <Badge tone="warning" className="uppercase tracking-wide">Demo Data</Badge>
      </div>
    </header>
  );
}
