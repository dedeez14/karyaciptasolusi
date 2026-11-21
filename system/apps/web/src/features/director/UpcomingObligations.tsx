import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { ObligationRow, type Obligations } from './ObligationsPage';

/** Dashboard: what is late or due within a week (hidden when nothing is) */
export function UpcomingObligations() {
  const q = useQuery({ queryKey: ['director', 'obligations', '30'], queryFn: () => api.get<Obligations>('/director/obligations', { days: 30 }), staleTime: 5 * 60_000 });
  const urgent = (q.data?.items ?? []).filter((o) => o.urgency !== 'LATER');
  if (!urgent.length) return null;
  return (
    <Card
      title="Due soon"
      subtitle={`${q.data!.counts.overdue ? `${q.data!.counts.overdue} late · ` : ''}${q.data!.counts.soon} within 7 days`}
      actions={
        <Link to="/director/obligations" className="link text-sm">
          Calendar
        </Link>
      }
      bodyClass="px-3 py-2"
    >
      <div className="grid grid-cols-1 gap-x-4 divide-line md:grid-cols-2">
        {urgent.slice(0, 8).map((o, i) => (
          <ObligationRow key={i} o={o} compact />
        ))}
      </div>
    </Card>
  );
}
