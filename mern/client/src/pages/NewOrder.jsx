import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { inr, todayIST } from "../format.js";
import { Alert, Button, Card, EmptyState, Field, PageHeader, Skeleton } from "../components/ui.jsx";

// SNJ sells on a 50% then 20% discount chain: the amount is rate x qty x 0.4.
const DISCOUNTS = { "50+20": 0.4, none: 1 };
const round2 = (n) => Math.round(n * 100) / 100;
const sizeAmount = (l, s) => round2((Number(l.rate) || 0) * (Number(s.qty) || 0) * DISCOUNTS[l.discount]);
const lineAmount = (l) => round2(l.sizes.reduce((t, s) => t + sizeAmount(l, s), 0));
const newSize = (due = "") => ({ size: "", qty: "", due_date: due });
const newLine = (due = "") => ({ item: "", rate: "", discount: "50+20", sizes: [newSize(due)] });

export default function NewOrder() {
  const { data: masters, error: loadError } = useApi("/api/masters");
  const [head, setHead] = useState({ order_no: "", date: todayIST(), party: "", reference: "", narration: "" });
  const [lines, setLines] = useState([newLine()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({});  // name checks show once a box is left, not while typing
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const navigate = useNavigate();
  useEffect(() => { document.title = "New order · SNJ Orders"; }, []);
  const units = useMemo(() => new Map((masters?.items || []).map((i) => [i.name, i.unit])), [masters]);
  const customers = useMemo(() => new Set((masters?.customers || []).map((c) => c.name)), [masters]);

  const setLine = (i, change) => setLines(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const setSize = (i, k, change) => setLine(i, { sizes: lines[i].sizes.map((s, j) => (j === k ? { ...s, ...change } : s)) });
  const total = round2(lines.reduce((t, l) => t + lineAmount(l), 0));
  const lastDue = () => lines.flatMap((l) => l.sizes).map((s) => s.due_date).filter(Boolean).at(-1) || "";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/changes", { method: "POST", body: JSON.stringify({ ...head, lines }) });
      navigate("/entries");
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setBusy(false);
    }
  };

  const header = <PageHeader title="New sales order" subtitle="It goes into Tally after someone approves it under Entries." />;
  if (loadError) return <>{header}<Alert>{loadError}</Alert></>;
  if (!masters) return <>{header}<Card><Skeleton height={36} /><p /><Skeleton height={36} width="60%" /></Card></>;
  if (!masters.customers.length) {
    return <>{header}<EmptyState title="Waiting for Tally's lists">
      The customer and item lists arrive from Tally with the bridge's next round, within about 10 minutes.
    </EmptyState></>;
  }

  return (
    <form onSubmit={submit} className="order-form">
      {header}
      <Alert onClose={() => setError(null)}>{error}</Alert>
      <datalist id="customers">{masters.customers.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <datalist id="items">{masters.items.map((i) => <option key={i.name} value={i.name} />)}</datalist>

      <Card title="Order">
        <div className="form-grid">
          <Field label="Customer" className="span-2"
                 error={touched.party && head.party && !customers.has(head.party) ? "Pick a name from the list, exactly as in Tally" : ""}>
            <input list="customers" value={head.party} required placeholder="Start typing the customer's name" onBlur={touch("party")}
                   onChange={(e) => setHead({ ...head, party: e.target.value })} />
          </Field>
          <Field label="Order no."><input value={head.order_no} required placeholder="SO/…"
                                          onChange={(e) => setHead({ ...head, order_no: e.target.value })} /></Field>
          <Field label="Order date"><input type="date" value={head.date} required max={todayIST()}
                                           onChange={(e) => setHead({ ...head, date: e.target.value })} /></Field>
          <Field label="Reference" hint="Optional"><input value={head.reference}
                                          onChange={(e) => setHead({ ...head, reference: e.target.value })} /></Field>
          <Field label="Note" hint="Optional" className="span-3"><input value={head.narration}
                                          onChange={(e) => setHead({ ...head, narration: e.target.value })} /></Field>
        </div>
      </Card>

      {lines.map((l, i) => (
        <Card key={i} title={`Item ${i + 1}`} actions={lines.length > 1 &&
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove item</Button>}>
          <div className="form-grid">
            <Field label="Item" className="span-2"
                   error={touched[`item${i}`] && l.item && !units.has(l.item) ? "Pick an item from the list, exactly as in Tally" : ""}>
              <input list="items" value={l.item} required onBlur={touch(`item${i}`)} onChange={(e) => setLine(i, { item: e.target.value })} />
            </Field>
            <Field label={`Rate ₹${units.get(l.item) ? ` per ${units.get(l.item)}` : ""}`}>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" value={l.rate} required
                     onChange={(e) => setLine(i, { rate: e.target.value })} />
            </Field>
            <Field label="Discount">
              <select value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })}>
                <option value="50+20">50% + 20%</option>
                <option value="none">None</option>
              </select>
            </Field>
          </div>
          <div className="size-grid">
            <div className="size-grid-head"><span>Size</span><span>Qty {units.get(l.item) || ""}</span><span>Due date</span><span className="num">Amount ₹</span><span /></div>
            {l.sizes.map((s, k) => (
              <div className="size-grid-row" key={k}>
                <input aria-label="Size" value={s.size} placeholder="Size, e.g. 32" onChange={(e) => setSize(i, k, { size: e.target.value })} />
                <input aria-label="Quantity" type="number" inputMode="decimal" min="0.01" step="0.01" value={s.qty} required placeholder={`Qty ${units.get(l.item) || ""}`.trim()}
                       onChange={(e) => setSize(i, k, { qty: e.target.value })} />
                <input aria-label="Due date" type="date" value={s.due_date} required min={head.date || undefined}
                       onChange={(e) => setSize(i, k, { due_date: e.target.value })} />
                <span className="num">{inr(sizeAmount(l, s))}</span>
                <span>{l.sizes.length > 1 && <button type="button" className="icon-btn" aria-label="Remove size"
                  onClick={() => setLine(i, { sizes: l.sizes.filter((_, j) => j !== k) })}>×</button>}</span>
              </div>
            ))}
          </div>
          <div className="card-foot">
            <Button type="button" variant="secondary" size="sm"
                    onClick={() => setLine(i, { sizes: [...l.sizes, newSize(l.sizes.at(-1)?.due_date)] })}>+ Add size</Button>
            <span className="muted">Item total <strong>₹{inr(lineAmount(l))}</strong></span>
          </div>
        </Card>
      ))}

      <div className="form-footer">
        <Button type="button" variant="secondary" onClick={() => setLines([...lines, newLine(lastDue())])}>+ Add item</Button>
        <span className="spacer" />
        <span className="total">Order total <strong>₹{inr(total)}</strong></span>
        <Link to="/entries" className="btn btn-ghost">Cancel</Link>
        <Button type="submit" loading={busy}>Send for approval</Button>
      </div>
    </form>
  );
}
