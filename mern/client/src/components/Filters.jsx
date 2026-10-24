import { useEffect, useState } from "react";
import { todayIST } from "../format.js";

// Search box that waits until typing pauses before searching.
export function SearchBox({ value, onChange, placeholder }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onChange(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="search">
      <span className="search-icon" aria-hidden="true">⌕</span>
      <input type="search" value={text} placeholder={placeholder} aria-label={placeholder}
             onChange={(e) => setText(e.target.value)}
             onKeyDown={(e) => e.key === "Enter" && onChange(text.trim())} />
    </div>
  );
}

// Status tabs with counts, e.g. "Not completed 2,276".
export function SegmentedFilter({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value}
                className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="count">{o.count.toLocaleString("en-IN")}</span>}
        </button>
      ))}
    </div>
  );
}

function shift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Ready-made ranges, worked out in India time.
export function presets() {
  const today = todayIST();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  const year = +today.slice(0, 4);
  const fyStart = +today.slice(5, 7) >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
  return [
    { label: "Today", from: today, to: today },
    { label: "Last 7 days", from: shift(today, -6), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: "This financial year", from: fyStart, to: today },
  ];
}

// From / To dates with quick ranges. Both ends count; To can't be before From.
export function DateRange({ from, to, onChange }) {
  const active = presets().find((p) => p.from === from && p.to === to);
  return (
    <div className="date-range">
      <select aria-label="Quick dates" value={active ? active.label : from || to ? "custom" : ""}
              onChange={(e) => {
                const p = presets().find((x) => x.label === e.target.value);
                if (p) onChange(p.from, p.to);
                else if (!e.target.value) onChange("", "");
              }}>
        <option value="">Any date</option>
        {presets().map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        {!active && (from || to) && <option value="custom">Custom dates</option>}
      </select>
      <input type="date" aria-label="From date" value={from} max={to || undefined}
             onChange={(e) => onChange(e.target.value, to && e.target.value > to ? e.target.value : to)} />
      <span className="muted">to</span>
      <input type="date" aria-label="To date" value={to} min={from || undefined}
             onChange={(e) => onChange(from && e.target.value && e.target.value < from ? e.target.value : from, e.target.value)} />
      {(from || to) && <button className="link-btn" onClick={() => onChange("", "")}>Clear</button>}
    </div>
  );
}
