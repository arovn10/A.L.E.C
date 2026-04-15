export default function StatCard({ label, value, unit, loading, alert }) {
  return (
    <div className="bg-alec-800 rounded-xl p-5 flex flex-col gap-2 border border-white/5">
      <span className="text-xs uppercase tracking-widest text-gray-400">{label}</span>

      {loading ? (
        <div className="h-8 w-24 rounded bg-white/10 animate-pulse" />
      ) : (
        <div className={`flex items-baseline gap-1 ${alert ? 'text-red-400' : 'text-white'}`}>
          <span className="text-3xl font-semibold leading-none">{value}</span>
          {unit && <span className="text-sm text-gray-400">{unit}</span>}
        </div>
      )}
    </div>
  );
}
