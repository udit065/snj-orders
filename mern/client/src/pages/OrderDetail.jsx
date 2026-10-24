import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { inr, niceDate, qty } from "../format.js";

export default function OrderDetail({ load, onKind }) {
  const { guid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    load(`/api/order/${encodeURIComponent(guid)}`).then((d) => {
      setData(d);
      onKind(d.order.kind);
      document.title = `Order ${d.order.number} · SNJ Orders`;
    }).catch((e) => setError(e.message));
  }, [guid, load, onKind]);

  if (error) return <><p className="error">{error}</p><p><Link to="/">Back to orders</Link></p></>;
  if (!data) return <p className="muted">Loading…</p>;
  const { order, items, history } = data;
  const sales = order.kind === "sales";
  const sentWord = sales ? "Sent" : "Received";

  return (
    <>
      <p><Link to={`/orders/${order.kind}`}>← All {order.kind} orders</Link></p>
      <h1>{order.voucher_type} {order.number} <span className={`st ${order.status}`}>{order.status_label}</span></h1>
      <dl className="facts">
        <div><dt>{sales ? "Customer" : "Supplier"}</dt><dd>{order.party}</dd></div>
        <div><dt>Date</dt><dd>{niceDate(order.date)}</dd></div>
        <div><dt>Amount</dt><dd>₹{inr(order.total)}</dd></div>
        {order.reference && <div><dt>Reference</dt><dd>{order.reference}</dd></div>}
      </dl>
      {order.narration && <p className="note">{order.narration}</p>}
      <table className="list sizes">
        <thead><tr>
          <th>Item / size</th><th className="n">Ordered</th><th className="n">{sentWord}</th>
          <th className="n">Left</th><th className="n">Amount ₹</th><th>Due</th>
        </tr></thead>
        {items.map((g) => (
          <tbody key={g.item}>
            <tr className="item">
              <td data-l="Item">{g.item}<span className="muted"> · ₹{inr(g.rate)}/{g.unit}</span></td>
              <td data-l="Ordered" className="n">{qty(g.qty)} {g.unit}</td>
              <td data-l={sentWord} className="n">{qty(g.sent)}</td>
              <td data-l="Left" className={`n ${g.left > 0 ? "left" : ""}`}>{qty(g.left)}</td>
              <td data-l="Amount ₹" className="n">{inr(g.amount)}</td>
              <td></td>
            </tr>
            {g.sizes.filter((l) => l.size || g.sizes.length > 1).map((l) => (
              <tr className="size" key={l.idx}>
                <td data-l="Size">{l.size ? `Size ${l.size}` : "—"}</td>
                <td data-l="Ordered" className="n">{qty(l.qty)}</td>
                <td data-l={sentWord} className="n">{qty(l.sent)}</td>
                <td data-l="Left" className={`n ${l.left > 0 ? "left" : ""}`}>{qty(l.left)}</td>
                <td data-l="Amount ₹" className="n">{inr(l.amount)}</td>
                <td data-l="Due">{niceDate(l.due_date)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <h2>{sales ? "Deliveries" : "Receipts"} against this order</h2>
      {history.length ? (
        <table className="list">
          <thead><tr><th>Date</th><th>Voucher</th><th>Item</th><th>Size</th><th className="n">Qty</th></tr></thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td data-l="Date">{niceDate(h.date)}</td><td data-l="Voucher">{h.voucher}</td>
                <td data-l="Item">{h.item}</td><td data-l="Size">{h.size}</td>
                <td data-l="Qty" className="n">{qty(h.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">Nothing {sales ? "sent" : "received"} against this order yet.</p>}
    </>
  );
}
