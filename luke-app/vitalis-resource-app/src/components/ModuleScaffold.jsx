import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from './PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/Card.jsx';
import { StatusChip } from './ui/StatusChip.jsx';

/**
 * ModuleScaffold — interim shell for a live module whose body is built in the next
 * pass. Keeps routing + the gate-status language stable so the dashboard is coherent
 * end-to-end while modules are filled in.
 */
export function ModuleScaffold({ title, description, icon: Icon, capabilities = [], gates = [] }) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={<StatusChip tone="accent" label="Module Online" />}
      />
      <Card>
        <CardHeader className="flex-row items-center gap-3">
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <Icon className="h-4.5 w-4.5" />
            </div>
          )}
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Wired to the server-authoritative gate engine.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {capabilities.length > 0 && (
            <ul className="space-y-1.5">
              {capabilities.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-soft">
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  {c}
                </li>
              ))}
            </ul>
          )}
          {gates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {gates.map((g) => (
                <StatusChip key={g} tone="success" label={g} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
