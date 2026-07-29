import { PackagePlus, UserCog } from 'lucide-react';
import api from '../lib/api.js';
import { useFetch } from '../lib/useApi.js';
import { useRole } from '../lib/roleContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { AddOnRequestCard } from '../components/addon/AddOnRequestCard.jsx';

/**
 * PracticeAddOns — the practice-wide add-on queue: every add-on request across THIS
 * practitioner's clients, each walked through confirm-fee → generate → attest → approve via
 * the shared AddOnRequestCard (the same control the client dossier uses). Per-client add-on
 * work also lives in each client's dossier Add-ons tab; this is the cross-client roll-up.
 */
export default function PracticeAddOns() {
  const { practitionerId } = useRole();
  const q = useFetch(
    () => (practitionerId ? api.practitionerAddOns(practitionerId, 'PRACTITIONER') : Promise.resolve(null)),
    [practitionerId],
  );

  if (!practitionerId) {
    return (
      <>
        <PageHeader title="Add-on Requests" description="Generate and approve client add-on resources." />
        <Card><CardContent className="py-10"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  if (q.loading) return <Loading label="Loading add-on requests…" />;
  if (q.error) return <ErrorState error={q.error} />;

  const requests = q.data?.requests || [];
  const pending = requests.filter((r) => r.status !== 'APPROVED_RESOURCE').length;

  return (
    <>
      <PageHeader
        title="Add-on Requests"
        description="Each add-on stays practitioner-only until you attest and approve it. Approving is the single action that makes the resource visible in the client’s portal."
        actions={<Badge tone={pending ? 'warning' : 'success'}>{pending} awaiting</Badge>}
      />
      {requests.length === 0 ? (
        <Card><CardContent className="py-12"><EmptyState title="No add-on requests yet" hint="Client supplement and meal-plan requests will appear here for review." icon={PackagePlus} /></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <AddOnRequestCard key={r.id} request={r} onChanged={() => q.reload()} />
          ))}
        </div>
      )}
    </>
  );
}
