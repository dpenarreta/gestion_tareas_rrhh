export default function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <h3 className="font-semibold text-title">{title}</h3>
      {children}
    </div>
  );
}
