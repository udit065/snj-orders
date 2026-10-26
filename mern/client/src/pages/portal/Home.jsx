import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../hooks/useApi.js";
import { inr, niceDate, niceTime, qty } from "../../format.js";
import { Alert, Badge, Card, EmptyState, PageHeader, PHOTO_TONE, Skeleton, Stat, STATUS_TONE, TopProgress } from "../../components/ui.jsx";

export default function Home() {
  const { data, error, loading } = useApi("/api/my/home");
  useEffect(() => { document.title = "Home · SNJ"; }, []);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) {
    return <div className="stats">{[1, 2, 3].map((i) => <div key={i} className="stat"><Skeleton width="50%" /><p /><Skeleton height={22} /></div>)}</div>;
  }
  if (!data.parties.length) {
    return <EmptyState title={`Namaste, ${data.name}`}>Your login isn't linked to your SNJ account yet. Please call SNJ.</EmptyState>;
  }
  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={`Namaste, ${data.name}`} subtitle={`As of ${niceTime(data.synced_at)}`}
                  actions={<Link to="/send-order" className="btn btn-primary">📷 Photograph your order pad</Link>} />
      <div className="stats">
        <Stat label="Open orders" value={data.open_orders}>not yet fully sent</Stat>
        <Stat label="Still to come" value={`₹${inr(data.value_left)}`}>{data.lines_left} item sizes</Stat>
        <Stat label="Past their due date" value={data.overdue_lines} tone={data.overdue_lines ? "late" : ""}>item sizes</Stat>
        {data.new_catalogues > 0 && <Stat label="New catalogues" value={data.new_catalogues}><Link to="/catalogue">Open the catalogue</Link></Stat>}
      </div>
      <div className="home-grid">
        <Card title="Coming to you next" padded={false}>
          {!data.coming_next.length ? <EmptyState title="Nothing waiting">Everything you ordered has been sent.</EmptyState> : (
            <ul className="list">
              {data.coming_next.map((l, i) => (
                <li key={i}>
                  <div>
                    <div className="strong">{l.item}{l.size && ` · size ${l.size}`}</div>
                    <div className="muted small">from order <Link to={`/order/${encodeURIComponent(l.guid)}`}>{l.order_no}</Link> of {niceDate(l.order_date)}</div>
                  </div>
                  <div className="num">
                    <div className="strong">{qty(l.left)} {l.unit}</div>
                    <div className={`small ${l.overdue ? "late" : "muted"}`}>{l.due_date ? `${l.overdue ? "was due" : "due"} ${niceDate(l.due_date)}` : "no due date"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.lines_left > data.coming_next.length && <div className="card-link"><Link to="/my/orders">See all open orders →</Link></div>}
        </Card>
        <div>
          <Card title="Recent orders" padded={false}>
            {!data.recent_orders.length ? <EmptyState title="No orders yet" /> : (
              <ul className="list">
                {data.recent_orders.map((o) => (
                  <li key={o.guid}>
                    <div><Link className="strong" to={`/order/${encodeURIComponent(o.guid)}`}>{o.number}</Link>
                      <div className="muted small">{niceDate(o.date)} · ₹{inr(o.total)}</div></div>
                    <Badge tone={STATUS_TONE[o.status]}>{o.status_label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Your order requests" padded={false} actions={<Link to="/send-order">Send one</Link>}>
            {!data.photos.length ? <EmptyState title="None sent yet">Write your order on your usual pad and send a photo.</EmptyState> : (
              <ul className="list">
                {data.photos.map((p) => (
                  <li key={p.id}>
                    <div><div className="strong">{niceTime(p.created_at)}</div>
                      <div className="muted small">{p.order_no ? `Order ${p.order_no}`
                        : p.kind === "repeat" ? `Order again of ${p.from_order?.number}` : p.note || p.party}</div></div>
                    <Badge tone={PHOTO_TONE[p.stage]}>{p.stage_label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="muted small center">Your balance, bills and payments will appear here soon.</p>
    </>
  );
}
