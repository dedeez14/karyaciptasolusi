import { themeColor } from '@/lib/theme';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtCompact, fmtMoney } from '@/lib/format';

export default function TrendChart({ data }: { data: { month: string; sales: number; purchases: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.month + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales" name="Sales" fill={themeColor('brand')} radius={[4, 4, 0, 0]} />
          <Bar dataKey="purchases" name="Purchases" fill={themeColor('accent')} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
