export function ModulePlaceholder({ title, description }: { title: string; description: string }) {
  return <section><div className="page-heading"><div><span className="eyebrow">WORKSPACE</span><h1>{title}</h1><p className="muted">{description}</p></div><span className="badge">In development</span></div>
    <div className="panel empty-state"><span className="empty-symbol" aria-hidden="true">◌</span><h2>This workspace is being prepared.</h2><p className="muted">This feature is not available yet. Your team is building it as part of the project.</p></div></section>;
}
