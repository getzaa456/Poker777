export function GlassButton({ children, className = '', label, sub, ...props }) {
  return (
    <button className={`glass-cta ${className}`.trim()} {...props}>
      <div className="glass-cta-shimmer-wrap">
        <div className="glass-cta-shimmer-inner"><div className="glass-cta-shimmer-conic" /></div>
      </div>
      <div className="glass-cta-cutout" />
      <div className="glass-cta-content">
        <div className="glass-cta-border-beam" />
        <div className="glass-cta-inner-bg" />
        {sub ? (
          <div className="glass-cta-text-group">
            <span className="glass-cta-label">{label}</span>
            <span className="glass-cta-sub">{sub}</span>
          </div>
        ) : (
          <span className="glass-cta-label">{label ?? children}</span>
        )}
      </div>
    </button>
  );
}
