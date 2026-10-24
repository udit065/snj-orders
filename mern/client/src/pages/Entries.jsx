import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { inr, niceDate, niceTime, qty } from "../format.js";

const BADGE = { to_approve: "pending", approved: "partly", sending: "partly", done: "done", failed: "failed",
                rejected: "cancelled", withdrawn: "cancelled" };

export default function Entries() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => api("/api/changes").then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    document.title = "Entries · SNJ Orders";
    refresh();
  }, [refresh]);

  const act = async (id, what) => {
    setError(null);
    try {
      await api(`/api/changes/${id}/${what}`, { method: "POST" });
    } catch (e) {
      setError(e.message);
    }
    refresh();
  };

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  return (
    <>
      <h1>Entries</h1>
      <p className="muted">New orders entered here, and where each one is on its way into Tally.
        {" "}<Link to="/new-order">Enter a new order</Link></p>
      {error && <p className="error">{error}</p>}
      {!data.changes.length ? <p className="muted">Nothing entered yet.</p> : data.changes.map((c) => (
        <details className="entry-card" key={c.id}>
          <summary>
            <span><strong>{c.order.order_no}</strong> · {c.order.party}</span>
            <span className="n">₹{inr(c.total)}</span>
            <span className={`st ${BADGE[c.status]}`}>{c.status_label}</span>
          </summary>
          {c.error && <p className="error">{c.error}</p>}
          <p className="muted">Order date {niceDate(c.order.date)}{c.order.reference && ` · Ref ${c.order.reference}`}
            {c.order.narration && ` · ${c.order.narration}`}</p>
          <table className="list">
            <thead><tr><th>Item</th><th>Size</th><th className="n">Qty</th><th className="n">Rate ₹</th><th>Discount</th><th>Due</th></tr></thead>
            <tbody>
              {c.order.lines.flatMap((l, i) => l.sizes.map((s, k) => (
                <tr key={`${i}-${k}`}>
                  <td data-l="Item">{l.item}</td><td data-l="Size">{s.size}</td>
                  <td data-l="Qty" className="n">{qty(s.qty)} {l.unit}</td><td data-l="Rate ₹" className="n">{inr(l.rate)}</td>
                  <td data-l="Discount">{l.discount === "none" ? "None" : "50% + 20%"}</td><td data-l="Due">{niceDate(s.due_date)}</td>
                </tr>
              )))}
            </tbody>
          </table>
          <ul className="history">
            {c.history.map((h, i) => (
              <li key={i}>{niceTime(h.at)} · {h.by === "bridge" ? "Bridge" : h.by} · {
                { to_approve: "entered it", approved: "approved it", sending: "started writing it into Tally",
                  done: "wrote it into Tally", failed: "could not write it", rejected: "rejected it",
                  withdrawn: "withdrew it" }[h.status]}</li>
            ))}
          </ul>
          <div className="row">
            {data.can_approve && c.status === "to_approve" && <>
              <button onClick={() => act(c.id, "approve")}>Approve</button>
              <button className="ghost" onClick={() => act(c.id, "reject")}>Reject</button>
            </>}
            {["to_approve", "approved"].includes(c.status) &&
              <button className="ghost" onClick={() => act(c.id, "withdraw")}>Withdraw</button>}
          </div>
        </details>
      ))}
    </>
  );
}
