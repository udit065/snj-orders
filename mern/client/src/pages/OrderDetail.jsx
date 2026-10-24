import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.js";
import { inr, niceDate, qty } from "../format.js";
import { Alert, Badge, Card, EmptyState, PageHeader, ProgressBar, Skeleton, STATUS_TONE } from "../components/ui.jsx";
import DataTable from "../components/DataTable.jsx";

export default function OrderDetail() {
  const { guid } = useParams();
  const { data, error, loading } = useApi(`/api/order/${encodeURIComponent(guid)}`);
  useEffect(() => { if (data) document.title = `Order ${data.order.number} · SNJ Orders`; }, [data]);

  if (error && !data) {
    return <><Alert>{error}</Alert><Link to="/">← Back to orders</Link></>;
  }
  if (!data || (loading && data.order.guid !== guid)) {
    return <Card><Skeleton width="40%" height={24} /><p /><Skeleton /><p /><Skeleton width="70%" /></Card>;
  }
  const { order, items, history } = data;
  const sales = order.kind === "sales";
  const sentWord = sales ? "Sent" : "Received";
  const ordered = items.reduce((t, g) => t + g.qty, 0);
  const sent = items.reduce((t, g) => t + g.sent, 0);
  const left = items.reduce((t, g) => t + g.left, 0);

  return (
    <>
      <PageHeader
        back={<Link className="back" to={`/orders/${order.kind}`}>← All {order.kind} orders</Link>}
        title={<>{order.number} <Badge tone={STATUS_TONE[order.status]}>{order.status_label}</Badge></>}
        subtitle={`${order.voucher_type} · ${niceDate(order.date)}`} />
      <div className="stats">
        <div className="stat"><span className="stat-label">{sales ? "Customer" : "Supplier"}</span><span className="stat-value">{order.party}</span></div>
        <div className="stat"><span className="stat-label">Amount</span><span className="stat-value">₹{inr(order.total)}</span></div>
        <div className="stat"><span className="stat-label">{sentWord} so far</span>
          <span className="stat-value">{qty(sent)} of {qty(ordered)}</span><ProgressBar value={sent} max={ordered} /></div>
        <div className="stat"><span className="stat-label">Left</span><span className={`stat-value ${left > 0 ? "warn" : ""}`}>{qty(left)}</span></div>
      </div>
      {(order.reference || order.narration) && (
        <p className="note">{order.reference && <><strong>Ref:</strong> {order.reference} </>}{order.narration}</p>
      )}
      <Card title="Items and sizes" padded={false}>
        <div className="table-wrap">
          <table className="table sizes">
            <thead><tr>
              <th>Item / size</th><th className="num">Ordered</th><th className="num">{sentWord}</th>
              <th className="num">Left</th><th className="num">Amount ₹</th><th>Due</th>
            </tr></thead>
            {items.map((g) => (
              <tbody key={g.item}>
                <tr className="item-row">
                  <td data-label="Item">{g.item}<span className="muted"> · ₹{inr(g.rate)}/{g.unit}</span></td>
                  <td data-label="Ordered" className="num">{qty(g.qty)} {g.unit}</td>
                  <td data-label={sentWord} className="num">{qty(g.sent)}</td>
                  <td data-label="Left" className={`num ${g.left > 0 ? "warn" : ""}`}>{qty(g.left)}</td>
                  <td data-label="Amount ₹" className="num">{inr(g.amount)}</td>
                  <td />
                </tr>
                {g.sizes.filter((l) => l.size || g.sizes.length > 1).map((l) => (
                  <tr className="size-row" key={l.idx}>
                    <td data-label="Size">{l.size ? `Size ${l.size}` : "—"}</td>
                    <td data-label="Ordered" className="num">{qty(l.qty)}</td>
                    <td data-label={sentWord} className="num">{qty(l.sent)}</td>
                    <td data-label="Left" className={`num ${l.left > 0 ? "warn" : ""}`}>{qty(l.left)}</td>
                    <td data-label="Amount ₹" className="num">{inr(l.amount)}</td>
                    <td data-label="Due" className="nowrap">{niceDate(l.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
      <Card title={`${sales ? "Deliveries" : "Receipts"} against this order`} padded={false}>
        <DataTable rows={history} rowKey={(h) => `${h.voucher}|${h.item}|${h.size}|${h.date}|${h.qty}`}
          empty={<EmptyState title={`Nothing ${sales ? "sent" : "received"} yet`} />}
          columns={[
            { key: "date", label: "Date", render: (h) => niceDate(h.date), className: () => "nowrap" },
            { key: "voucher", label: "Voucher" },
            { key: "item", label: "Item" },
            { key: "size", label: "Size" },
            { key: "qty", label: "Qty", align: "right", render: (h) => qty(h.qty) },
          ]} />
      </Card>
    </>
  );
}
