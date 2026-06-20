import { Package, ShieldCheck, UserCog } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { PackageView } from '../components/package/PackageView.jsx';
import { TimelineRail } from '../components/dashboard/composers.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';

// The request → review → approve journey shown when there is no approved package yet, so the
// empty state communicates progress instead of a bare box.
const PACKAGE_JOURNEY = [
  { label: 'Protocol approved', sub: 'Your starting point', state: 'pending' },
  { label: 'Package assembled', sub: 'Protocol + labs + nutrition', state: 'pending' },
  { label: 'Approved for you', sub: 'Opens here', state: 'pending' },
];

/**
 * PortalPackage — the client's "My Care Package" surface: the one-click bundle their
 * practitioner generated and approved, opened read-only. It asks ONLY for
 * api.clientPackage(clientId), whose server projection composes the spine from this
 * client's APPROVED protocols (clientVisibleProtocols) — the SAME approval boundary as
 * every other portal surface. A draft physically cannot reach this page; the endpoint
 * returns status NO_PROTOCOL until something is approved.
 *
 * The package itself renders through the shared, presentational PackageView — the exact
 * component the practitioner previews — so the client sees an identical layout, only with
 * the operator-only facets (dosing schedules, titration/taper, clinical rationale) already
 * stripped server-side. Nothing here is framed as a prescription; resource-only throughout.
 */
export default function PortalPackage() {
  const { clientId } = useRole();
  const pkgQ = useFetch(() => (clientId ? api.clientPackage(clientId) : Promise.resolve(null)), [clientId]);

  if (!clientId) {
    return (
      <>
        <PageHeader title="My Care Package" description="Your approved care package." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher to view their portal." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  if (pkgQ.loading) return <Loading label="Loading your care package…" />;
  if (pkgQ.error) return <ErrorState error={pkgQ.error} />;

  const pkg = pkgQ.data?.package || null;
  const status = pkgQ.data?.status;
  const disclaimer = pkgQ.data?.disclaimer;

  return (
    <>
      <PageHeader
        title="My Care Package"
        description="Everything your practitioner put together for you in one place — your protocol, the bloodwork to ask for, and your nutrition follow-up. An educational resource your practitioner approved — never a prescription or medical advice."
        actions={pkg ? <StatusChip status="approved_resource" label="Approved for you" /> : null}
      />

      <div className="mb-5 flex items-start gap-2 rounded-md border border-border-soft bg-neutral-soft px-3 py-2.5 text-xs text-soft">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>This package was reviewed and approved by your practitioner as an educational resource — not a prescription. Anything still being drafted is <span className="font-medium text-foreground">never</span> shown here; you’ll see your package the moment it’s approved, and it updates here if your practitioner changes it.</span>
      </div>

      {status === 'NO_PROTOCOL' || !pkg ? (
        <div className="space-y-5">
          <section className="space-y-3">
            <SectionHeader eyebrow="How it works" title="Your care-package journey" sub="What goes into your package and when it appears." />
            <TimelineRail steps={PACKAGE_JOURNEY} />
          </section>
          <Card>
            <CardContent className="py-12">
              <EmptyState
                title="No care package yet"
                hint="Your practitioner hasn’t approved a care package for you. Drafts in progress are never shown here — your package will appear the moment it’s approved."
                icon={Package}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <PackageView pkg={pkg} />
      )}

      {disclaimer && <p className="mt-6 text-2xs leading-relaxed text-faint">{disclaimer}</p>}
    </>
  );
}
