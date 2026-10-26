// Small building blocks shared by every page.
import { useEffect, useState } from "react";

export function Button({ variant = "primary", size, loading = false, children, className = "", ...props }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`}
            disabled={loading || props.disabled} {...props}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small = false, label }) {
  return <span className={`spinner ${small ? "spinner-sm" : ""}`} role="status" aria-label={label || "Loading"} />;
}

export function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// Order status -> badge colour
export const STATUS_TONE = { pending: "warn", partly: "info", done: "ok", cancelled: "muted" };

export function Card({ title, actions, children, className = "", padded = true }) {
  return (
    <section className={`card ${padded ? "card-pad" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      {back}
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = "error", children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {onClose && <button className="alert-close" onClick={onClose} aria-label="Close">×</button>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Field({ label, hint, error, className = "", children }) {
  return (
    <label className={`field ${error ? "field-error" : ""} ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {(error || hint) && <span className="field-hint">{error || hint}</span>}
    </label>
  );
}

export function Skeleton({ width = "100%", height = 14 }) {
  return <span className="skeleton" style={{ width, height }} />;
}

// A thin bar across the top of the page while something loads.
export function TopProgress({ active }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return setShown(false);
    const t = setTimeout(() => setShown(true), 150);  // quick loads don't flicker
    return () => clearTimeout(t);
  }, [active]);
  return <div className={`top-progress ${shown ? "on" : ""}`} />;
}

export function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" title={`${pct}%`}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Where an order-pad photo has got to.
export const PHOTO_TONE = { received: "warn", entered: "info", done: "ok", rejected: "bad" };

export function Stat({ label, value, tone, children }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone || ""}`}>{value}</span>
      {children && <span className="stat-sub">{children}</span>}
    </div>
  );
}
