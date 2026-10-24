import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { inr } from "../format.js";

// SNJ sells on a 50% then 20% discount chain: the amount is rate x qty x 0.4.
const DISCOUNTS = { "50+20": 0.4, none: 1 };
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const newSize = (due = "") => ({ size: "", qty: "", due_date: due });
const newLine = () => ({ item: "", rate: "", discount: "50+20", sizes: [newSize()] });

function lineAmount(l) {
  return round2(l.sizes.reduce((t, s) => t + round2((Number(l.rate) || 0) * (Number(s.qty) || 0) * DISCOUNTS[l.discount]), 0));
}

export default function NewOrder() {
  const [masters, setMasters] = useState(null);
  const [head, setHead] = useState({ order_no: "", date: today(), party: "", reference: "", narration: "" });
  const [lines, setLines] = useState([newLine()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "New order · SNJ Orders";
    api("/api/masters").then(setMasters).catch((e) => setError(e.message));
  }, []);
  const units = useMemo(() => new Map((masters?.items || []).map((i) => [i.name, i.unit])), [masters]);

  const setLine = (i, change) => setLines(lines.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const setSize = (i, k, change) => setLine(i, { sizes: lines[i].sizes.map((s, j) => (j === k ? { ...s, ...change } : s)) });
  const total = round2(lines.reduce((t, l) => t + lineAmount(l), 0));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/changes", { method: "POST", body: JSON.stringify({ ...head, lines }) });
      navigate("/entries");
    } catch (err) {
      setError(err.message);
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  };

  if (!masters) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  if (!masters.customers.length) {
    return <p className="error">The customer and item lists haven't arrived from Tally yet. The bridge sends them within its next round.</p>;
  }

  return (
    <form className="entry" onSubmit={submit}>
      <h1>New sales order</h1>
      <p className="muted">It goes into Tally after someone approves it under Entries.</p>
      {error && <p className="error">{error}</p>}
      <datalist id="customers">{masters.customers.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <datalist id="items">{masters.items.map((i) => <option key={i.name} value={i.name} />)}</datalist>
      <div className="fields">
        <label className="wide">Customer
          <input list="customers" value={head.party} required onChange={(e) => setHead({ ...head, party: e.target.value })}
                 placeholder="Start typing the name as in Tally" />
        </label>
        <label>Order no.
          <input value={head.order_no} required onChange={(e) => setHead({ ...head, order_no: e.target.value })} placeholder="SO/…" />
        </label>
        <label>Date
          <input type="date" value={head.date} required onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </label>
        <label>Reference <input value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} /></label>
        <label className="wide">Note <input value={head.narration} onChange={(e) => setHead({ ...head, narration: e.target.value })} /></label>
      </div>

      {lines.map((l, i) => (
        <fieldset className="line" key={i}>
          <div className="fields">
            <label className="wide">Item
              <input list="items" value={l.item} required onChange={(e) => setLine(i, { item: e.target.value })} />
            </label>
            <label>Rate ₹ {units.get(l.item) ? `per ${units.get(l.item)}` : ""}
              <input type="number" min="0" step="0.01" value={l.rate} required onChange={(e) => setLine(i, { rate: e.target.value })} />
            </label>
            <label>Discount
              <select value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })}>
                <option value="50+20">50% + 20%</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <table className="list sizes-entry">
            <thead><tr><th>Size</th><th className="n">Qty {units.get(l.item) || ""}</th><th>Due date</th><th className="n">Amount ₹</th><th></th></tr></thead>
            <tbody>
              {l.sizes.map((s, k) => (
                <tr key={k}>
                  <td data-l="Size"><input value={s.size} onChange={(e) => setSize(i, k, { size: e.target.value })} placeholder="e.g. 32" /></td>
                  <td data-l="Qty" className="n"><input type="number" min="0" step="0.01" value={s.qty} required
                                                        onChange={(e) => setSize(i, k, { qty: e.target.value })} /></td>
                  <td data-l="Due date"><input type="date" value={s.due_date} required onChange={(e) => setSize(i, k, { due_date: e.target.value })} /></td>
                  <td data-l="Amount ₹" className="n">{inr(round2((Number(l.rate) || 0) * (Number(s.qty) || 0) * DISCOUNTS[l.discount]))}</td>
                  <td>{l.sizes.length > 1 && <button type="button" className="ghost"
                    onClick={() => setLine(i, { sizes: l.sizes.filter((_, j) => j !== k) })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button type="button" className="ghost"
                    onClick={() => setLine(i, { sizes: [...l.sizes, newSize(l.sizes.at(-1)?.due_date)] })}>+ Add size</button>
            <span className="muted">Item total ₹{inr(lineAmount(l))}</span>
            {lines.length > 1 && <button type="button" className="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove item</button>}
          </div>
        </fieldset>
      ))}
      <div className="row">
        <button type="button" className="ghost" onClick={() => setLines([...lines, newLine()])}>+ Add item</button>
        <strong>Order total ₹{inr(total)}</strong>
      </div>
      <p><button disabled={busy}>{busy ? "Saving…" : "Send for approval"}</button></p>
    </form>
  );
}
