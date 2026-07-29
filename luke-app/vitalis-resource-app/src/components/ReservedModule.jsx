import { Lock, CheckCircle2 } from 'lucide-react';
import { PageHeader } from './PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/Card.jsx';
import { StatusChip } from './ui/StatusChip.jsx';

/**
 * ReservedModule — a clean, honest placeholder for a defined-but-not-wired module.
 * Mirrors @vitalis/protocol-core/reserved: status RESERVED, no fabricated output.
 * Reserving the route + component + data models now means the module plugs in later
 * with NO platform rebuild.
 */
export function ReservedModule({ title, description, icon: Icon, summary, models = [], capabilities = [], usesBloodwork }) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={<StatusChip status="reserved" label="Reserved" dashed />}
      />

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-faint">
              <Icon className="h-4.5 w-4.5" />
            </div>
          )}
          <div>
            <CardTitle>Defined, not yet wired</CardTitle>
            <CardDescription>{summary}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {capabilities.length > 0 && (
            <div>
              <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Planned capabilities</div>
              <ul className="space-y-1.5">
                {capabilities.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-soft">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {models.length > 0 && (
            <div>
              <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Reserved data models</div>
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <span key={m} className="font-data rounded border border-dashed border-border px-2 py-0.5 text-2xs text-soft">{m}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-border-soft bg-muted/40 px-3 py-2.5 text-xs text-soft">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
            <span>
              An unwired module returns status <span className="font-data">RESERVED</span> with empty results — it never invents
              targets, macros, or plans.{' '}
              {usesBloodwork && 'When wired, it uses bloodwork where available and flags provider review when labs suggest a medical concern — it never diagnoses.'}{' '}
              Resource / educational only — never medical advice.
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
