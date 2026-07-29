import { ClipboardCheck, UserCog } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { DraftCard } from '../components/DraftCard.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

export default function PracticeReviews() {
  const { practitionerId } = useRole();
  const pracQ = useFetch(() => (practitionerId ? api.practitioner(practitionerId) : Promise.resolve(null)), [practitionerId]);
  const reviewsQ = useFetch(() => (practitionerId ? api.practitionerReviews(practitionerId) : Promise.resolve(null)), [practitionerId]);

  if (!practitionerId) {
    return (
      <>
        <PageHeader title="Review Queue" description="Drafts awaiting your decision." />
        <Card><CardContent className="py-10"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  if (reviewsQ.loading) return <Loading label="Loading review queue…" />;
  if (reviewsQ.error) return <ErrorState error={reviewsQ.error} />;

  const reviewer = pracQ.data?.practitioner?.name;
  const queue = reviewsQ.data?.reviews || [];

  return (
    <>
      <PageHeader
        title="Review Queue"
        description="Each draft stays practitioner-only until you approve it. Approving is the single action that makes a protocol visible in the client’s portal."
        actions={<Badge tone={queue.length ? 'warning' : 'success'}>{queue.length} awaiting</Badge>}
      />
      {queue.length === 0 ? (
        <Card><CardContent className="py-12"><EmptyState title="Queue clear" hint="No drafts are awaiting review for this practice." icon={ClipboardCheck} /></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {queue.map((d) => (
            <DraftCard key={d.id} draft={d} reviewer={reviewer} showClient onReviewed={() => reviewsQ.reload()} />
          ))}
        </div>
      )}
    </>
  );
}
