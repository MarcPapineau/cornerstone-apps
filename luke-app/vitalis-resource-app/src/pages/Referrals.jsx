import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Stethoscope, UserRound, Phone, ArrowRight, Info, ShieldQuestion,
  MapPin, Network, Send, Handshake, FileText, Construction,
} from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import EcosystemDiagram from '../components/diagrams/EcosystemDiagram.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Label, Select } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const noop = () => Promise.resolve(null);

// Map a referral lifecycle status → a StatusChip tone (honest, no fake-green).
const REFERRAL_TONE = { PENDING: 'warning', ACCEPTED: 'success', DECLINED: 'danger' };

function ScaffoldTag({ children = 'Scaffold' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-warning/40 bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
      <Construction className="h-3 w-3" /> {children}
    </span>
  );
}

function ProviderCard({ provider }) {
  return (
    <div className="rounded-md border border-border-soft p-3.5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-primary">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{provider.name}</div>
          <div className="text-2xs text-faint">{provider.role}</div>
          {provider.contact && (
            <a href={`tel:${provider.contact.replace(/[^\d+]/g, '')}`} className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline">
              <Phone className="h-3 w-3" /> {provider.contact}
            </a>
          )}
        </div>
      </div>
      {provider.note && <p className="mt-2.5 border-t border-border-soft pt-2.5 text-xs text-soft">{provider.note}</p>}
      {(provider.focus || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {provider.focus.map((f) => (
            <Badge key={f} tone="neutral" className="font-data text-2xs">{f}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferralCard({ item: r }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{r.label}</CardTitle>
          <StatusChip tone="accent" label="Suggestion" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Observed</div>
          <p className="text-xs text-soft">{r.whenObserved}</p>
        </div>
        {r.suggests && (
          <div className="flex items-start gap-1.5 text-xs text-soft">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span><span className="font-medium text-foreground">Suggests:</span> {r.suggests}</span>
          </div>
        )}
        {r.provider && (
          <div className="flex items-center gap-2 rounded-md border border-border-soft bg-muted/40 p-2.5">
            <UserRound className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 text-xs">
              <span className="font-medium text-foreground">{r.provider.name}</span>
              <span className="text-faint"> · {r.provider.role}</span>
              {r.provider.contact && <span className="ml-1 font-data text-2xs text-faint">{r.provider.contact}</span>}
            </div>
          </div>
        )}
        <div className="flex items-start gap-1.5 border-t border-border-soft pt-2.5 text-2xs text-faint">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{r.disclaimer}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Network match (location + service filtered partner practitioner) --------
function NetworkMatchCard({ match: m }) {
  const loc = m.location || {};
  return (
    <div className="rounded-md border border-border-soft p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{m.name}</div>
          <div className="text-2xs text-faint">{m.occupation}</div>
        </div>
        {m.practitionerType && <Badge tone="accent" className="font-data text-2xs">{m.practitionerType}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-soft">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3 text-primary" />
          {[loc.city, loc.region].filter(Boolean).join(', ') || 'Location UNKNOWN'}
          {m.serviceRadiusKm ? <span className="text-faint"> · ~{m.serviceRadiusKm} km</span> : null}
        </span>
        {m.contact && (
          <a href={`tel:${m.contact.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <Phone className="h-3 w-3" /> {m.contact}
          </a>
        )}
      </div>
      {(m.credentials || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.credentials.map((c) => (
            <Badge key={c} tone="neutral" className="font-data text-2xs">{c}</Badge>
          ))}
        </div>
      )}
      {(m.servicesOffered || []).length > 0 && (
        <p className="mt-2 text-2xs text-faint">
          <span className="font-semibold uppercase tracking-wide">Offers:</span>{' '}
          {m.servicesOffered.join(' · ')}
        </p>
      )}
      {/* Scaffold action — sending a referral + the document is documented but NOT wired. */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-soft pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-2xs text-faint">
          <Send className="h-3 w-3" /> Send referral
        </span>
        <ScaffoldTag>Not wired</ScaffoldTag>
      </div>
    </div>
  );
}

// --- Referral status (sent / accepted / declined / handshake) ---------------
function ReferralStatusRow({ item: r }) {
  const tone = REFERRAL_TONE[r.status] || 'neutral';
  return (
    <div className="rounded-md border border-border-soft p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">{r.serviceLabel}</div>
          <div className="mt-0.5 flex items-center gap-1 text-2xs text-faint">
            <span>{r.fromName}</span>
            <ArrowRight className="h-3 w-3" />
            <span>{r.toName}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip tone={tone} label={r.direction === 'SENT' ? `Sent · ${r.status}` : r.status} />
          {r.handshake && <StatusChip tone="success" label="Handshake" />}
        </div>
      </div>
      {r.reason && <p className="mt-2 text-2xs text-soft">{r.reason}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-faint">
        {r.documentRef && (
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" /> {r.documentRef.kind} ({r.documentRef.silo})
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span className="font-semibold uppercase tracking-wide">Fee:</span> {r.feeStatus || 'NONE'}
        </span>
      </div>
      {r.disclaimer && (
        <p className="mt-2 border-t border-border-soft pt-2 text-[10px] text-faint">{r.disclaimer}</p>
      )}
    </div>
  );
}

export default function Referrals() {
  // Reached as a per-client dossier ACTION (?clientId=) — same IA as /package, /labs/results.
  const [searchParams] = useSearchParams();
  const presetClient = searchParams.get('clientId') || '';
  const [clientId, setClientId] = useState(presetClient);
  const [service, setService] = useState('');
  const [region, setRegion] = useState('');

  const referralsQ = useFetch(() => (clientId ? api.referrals(clientId) : noop()), [clientId]);
  const providersQ = useFetch(() => api.providers(), []);
  // Network roster is location + service filtered server-side (suggestion-only scaffold).
  const networkQ = useFetch(
    () => api.referralNetwork({ clientId: clientId || undefined, service: service || undefined, region: region || undefined }),
    [clientId, service, region],
  );
  const statusQ = useFetch(() => api.referralStatus(clientId || undefined), [clientId]);

  const referrals = referralsQ.data?.referrals || [];
  const providers = providersQ.data?.providers || [];
  const categories = providersQ.data?.categories || [];
  const services = networkQ.data?.services || [];
  const matches = networkQ.data?.matches || [];
  const statusReferrals = statusQ.data?.referrals || [];

  return (
    <>
      <PageHeader
        title="Providers & Referrals"
        description="Referral categories surfaced from a client's observed signals — flagged labs and stated goals. Every entry is a suggestion routed to a provider, never a diagnosis."
        actions={<StatusChip tone="success" label="Suggestions, Not Diagnoses" />}
      />

      {/* ================= VITALIS ECOSYSTEM (presentation hero) ================= */}
      {/* The platform map: a central server-authoritative approval gate + evidence doctrine with
          the real building-block silos. Early-access / roadmap nodes (incl. this referral network)
          are de-weighted and labelled — no named partners, no live revenue. Honest category framing. */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card px-2 py-4 shadow-card sm:px-6">
        <div className="mb-2 text-center">
          <div className="font-label text-2xs font-semibold uppercase tracking-[0.18em] text-gold">Powered by Vitalis</div>
          <h2 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-[2.5rem]">Vitalis Ecosystem</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-soft">Every surface routes through one server-authoritative approval gate. Live silos are wired today; early-access and roadmap nodes — including this referral network — are labelled, not pretended.</p>
        </div>
        <EcosystemDiagram />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-2xs text-faint">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-chart-1" /> Live</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'hsl(217 48% 58%)' }} /> Early access</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-chart-2" /> Roadmap (not wired)</span>
        </div>
      </section>

      <div className="mb-5 max-w-xs">
        <ClientPicker value={clientId} onChange={setClientId} autoSelectFirst />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-faint">
            <ShieldQuestion className="h-3.5 w-3.5" /> Referral suggestions for this client
          </div>
          {!clientId ? (
            <EmptyState title="Select a client" hint="Pick a client to surface referral suggestions from their observed signals." icon={Stethoscope} />
          ) : referralsQ.loading ? (
            <Loading />
          ) : referralsQ.error ? (
            <ErrorState error={referralsQ.error} />
          ) : referrals.length === 0 ? (
            <EmptyState
              title="No referral signals"
              hint="No flagged labs or goal patterns currently map to a referral category. Nothing is invented to fill the gap."
              icon={ShieldQuestion}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {referrals.map((r, i) => (
                <ReferralCard key={r.trigger || i} item={r} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                <Stethoscope className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle>Provider directory</CardTitle>
                <CardDescription>Named providers surfaced for the operator — nothing is auto-booked.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {providersQ.loading ? (
                <Loading />
              ) : providersQ.error ? (
                <ErrorState error={providersQ.error} />
              ) : (
                providers.map((p) => <ProviderCard key={p.id} provider={p} />)
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ================= INTER-INDUSTRY REFERRAL NETWORK (SCAFFOLD) ================= */}
      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                <Network className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle>Cross-discipline referral network</CardTitle>
                <CardDescription>
                  When a client needs a service outside this practitioner's scope, filter the partner roster by service + location.
                  This finds matching practitioners only — sending the referral, the recipient handshake, and any future fee are scaffold.
                </CardDescription>
              </div>
            </div>
            <ScaffoldTag>Filter live · transport scaffold</ScaffoldTag>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter controls: service + region. The service vocabulary mirrors the gate's categories. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Needed service</Label>
              <Select value={service} onChange={(e) => setService(e.target.value)}>
                <option value="">Any service</option>
                {services.map((s) => (
                  <option key={s.service} value={s.service}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Region</Label>
              <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Any region</option>
                <option value="ON">Ontario (ON)</option>
                <option value="QC">Quebec (QC)</option>
              </Select>
            </div>
          </div>

          {networkQ.loading ? (
            <Loading />
          ) : networkQ.error ? (
            <ErrorState error={networkQ.error} />
          ) : matches.length === 0 ? (
            <EmptyState
              title="No matching practitioners"
              hint="No roster member currently offers that service in that region (members not accepting referrals are excluded). Nothing is invented to fill the list."
              icon={Network}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {matches.map((m) => (
                <NetworkMatchCard key={m.id} match={m} />
              ))}
            </div>
          )}

          <p className="flex items-start gap-1.5 rounded-md border border-dashed border-border-soft bg-muted/30 p-2.5 text-2xs text-faint">
            <Handshake className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <span className="font-semibold text-soft">Handshake flow (scaffold):</span> selecting a recipient would send the referral plus
              the relevant requisition/document; the recipient accepts or declines; on accept a mutual handshake is recorded. No service is
              booked and no fee is executed here — this is a suggestion surface. See <span className="font-data">docs/REFERRAL-SYSTEM.md</span>.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* ================= REFERRAL STATUS (sent / accepted / handshake) ================= */}
      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Referral status</CardTitle>
              <CardDescription>
                Demo referral records for this client — sent, accepted, declined, with the handshake flag. Status is illustrative; no live transport or fee.
              </CardDescription>
            </div>
            <ScaffoldTag>Demo records</ScaffoldTag>
          </div>
        </CardHeader>
        <CardContent>
          {statusQ.loading ? (
            <Loading />
          ) : statusQ.error ? (
            <ErrorState error={statusQ.error} />
          ) : statusReferrals.length === 0 ? (
            <EmptyState
              title="No referrals on record"
              hint={clientId ? 'This client has no demo referral records.' : 'Select a client to see their referral records.'}
              icon={Send}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {statusReferrals.map((r) => (
                <ReferralStatusRow key={r.id} item={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Referral category library</CardTitle>
          <CardDescription>The full set of categories the gate can surface, with the observation that triggers each. Conservative by design — a match suggests a review, never a condition.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {categories.map((c) => (
              <div key={c.trigger} className="rounded-md border border-border-soft p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{c.label}</span>
                  <Badge tone="outline" className="font-data text-2xs">{c.trigger}</Badge>
                </div>
                <p className="text-2xs text-faint">{c.whenObserved}</p>
                <p className="mt-1.5 border-t border-border-soft pt-1.5 text-2xs text-faint">{c.disclaimer}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
