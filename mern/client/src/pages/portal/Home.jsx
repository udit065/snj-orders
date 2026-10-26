import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../hooks/useApi.js";
import Contact from "../../components/Contact.jsx";
import PostCard from "../../components/PostCard.jsx";
import { inr, niceDate, niceTime, qty } from "../../format.js";
import { Alert, Badge, Card, EmptyState, PageHeader, PHOTO_TONE, Skeleton, Stat, STATUS_TONE, TopProgress } from "../../components/ui.jsx";
import { useT } from "../../i18n.jsx";

export default function Home() {
  const t = useT();
  const { data, error, loading } = useApi("/api/my/home");
  useEffect(() => { document.title = "Home · SNJ"; }, []);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) {
    return <div className="stats">{[1, 2, 3].map((i) => <div key={i} className="stat"><Skeleton width="50%" /><p /><Skeleton height={22} /></div>)}</div>;
  }
  if (!data.parties.length) {
    return <EmptyState title={t("Namaste, {name}", { name: data.name })}>{t("Your login isn't linked to your SNJ account yet. Please call SNJ.")}</EmptyState>;
  }
  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={t("Namaste, {name}", { name: data.name })} subtitle={t("As of {time}", { time: niceTime(data.synced_at) })}
                  actions={<Link to="/send-order" className="btn btn-primary">{t("📷 Photograph your order pad")}</Link>} />
      {data.posts.length > 0 && (
        <div className="post-strip">
          {data.posts.map((p) => <PostCard key={p.id} post={p} />)}
          <Link to="/news" className="post-strip-more">{t("All news and offers →")}</Link>
        </div>
      )}
      <div className="stats">
        {data.account && <Stat label={t("Balance")} value={`₹${inr(Math.abs(data.account.balance))}`}>
          <Link to="/account">{data.account.balance < 0 ? t("in your favour") : t("to pay SNJ")}</Link></Stat>}
        {data.account && <Stat label={t("Overdue")} value={`₹${inr(data.account.overdue)}`} tone={data.account.overdue ? "late" : ""}>
          <Link to="/account?tab=bills">{data.account.overdue ? t("see bills to pay") : t("nothing overdue")}</Link></Stat>}
        <Stat label={t("Open orders")} value={data.open_orders}>{t("not yet fully sent")}</Stat>
        <Stat label={t("Still to come")} value={`₹${inr(data.value_left)}`}>{t("{n} item sizes", { n: data.lines_left })}</Stat>
        <Stat label={t("Past their due date")} value={data.overdue_lines} tone={data.overdue_lines ? "late" : ""}>{t("item sizes")}</Stat>
        {data.new_catalogues > 0 && <Stat label={t("New catalogues")} value={data.new_catalogues}><Link to="/catalogue">{t("Open the catalogue")}</Link></Stat>}
      </div>
      <div className="home-grid">
        <Card title={t("Coming to you next")} padded={false}>
          {!data.coming_next.length ? <EmptyState title={t("Nothing waiting")}>{t("Everything you ordered has been sent.")}</EmptyState> : (
            <ul className="list">
              {data.coming_next.map((l, i) => (
                <li key={i}>
                  <div>
                    <div className="strong">{l.item}{l.size && ` · size ${l.size}`}</div>
                    <div className="muted small">{t("from order")} <Link to={`/order/${encodeURIComponent(l.guid)}`}>{l.order_no}</Link> {t("of")} {niceDate(l.order_date)}</div>
                  </div>
                  <div className="num">
                    <div className="strong">{qty(l.left)} {l.unit}</div>
                    <div className={`small ${l.overdue ? "late" : "muted"}`}>{l.due_date ? `${t(l.overdue ? "was due" : "due")} ${niceDate(l.due_date)}` : t("no due date")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.lines_left > data.coming_next.length && <div className="card-link"><Link to="/my/orders">{t("See all open orders →")}</Link></div>}
        </Card>
        <div>
          {data.account?.recent_bills.length > 0 && (
            <Card title={t("Recent bills")} padded={false} actions={<Link to="/account?tab=bills">{t("All bills")}</Link>}>
              <ul className="list">
                {data.account.recent_bills.map((b) => (
                  <li key={b.id}>
                    <div><Link className="strong" to={`/bill/${b.id}`}>{b.number}</Link>
                      <div className="muted small">{niceDate(b.date)}{b.ship && ` · ${[b.ship.shipped_by, b.ship.lr_no && `LR ${b.ship.lr_no}`].filter(Boolean).join(" · ")}`}</div></div>
                    <span className="num strong">₹{inr(b.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={t("Recent orders")} padded={false}>
            {!data.recent_orders.length ? <EmptyState title={t("No orders yet")} /> : (
              <ul className="list">
                {data.recent_orders.map((o) => (
                  <li key={o.guid}>
                    <div><Link className="strong" to={`/order/${encodeURIComponent(o.guid)}`}>{o.number}</Link>
                      <div className="muted small">{niceDate(o.date)} · ₹{inr(o.total)}</div></div>
                    <Badge tone={STATUS_TONE[o.status]}>{t(o.status_label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("Your order requests")} padded={false} actions={<Link to="/send-order">{t("Send one")}</Link>}>
            {!data.photos.length ? <EmptyState title={t("None sent yet")}>{t("Write your order on your usual pad and send a photo.")}</EmptyState> : (
              <ul className="list">
                {data.photos.map((p) => (
                  <li key={p.id}>
                    <div><div className="strong">{niceTime(p.created_at)}</div>
                      <div className="muted small">{p.order_no ? t("Order {n}", { n: p.order_no })
                        : p.kind === "repeat" ? t("Order again of {n}", { n: p.from_order?.number }) : p.note || p.party}</div></div>
                    <Badge tone={PHOTO_TONE[p.stage]}>{t(p.stage_label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <div className="quick-links">
        <Link to="/payments" className="quick-link"><span aria-hidden="true">₹</span><span><b>{t("Tell us you've paid")}</b><br /><span className="muted small">{t("UPI, bank transfer or cheque")}</span></span></Link>
        <Link to="/claims" className="quick-link"><span aria-hidden="true">⚠</span><span><b>{t("Report damaged or short goods")}</b><br /><span className="muted small">{t("with photos")}</span></span></Link>
      </div>
      <Contact contact={data.contact} />
      {!data.account && <p className="muted small center">{t("Your balance and bills will appear here soon.")}</p>}
    </>
  );
}
