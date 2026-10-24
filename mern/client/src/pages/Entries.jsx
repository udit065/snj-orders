import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { inr, niceDate, niceTime, qty } from "../format.js";
import Pagination from "../components/Pagination.jsx";
import { Alert, Badge, Button, EmptyState, PageHeader, Skeleton, TopProgress } from "../components/ui.jsx";

const TONE = { to_approve: "warn", approved: "info", sending: "info", done: "ok", failed: "bad",
               rejected: "muted", withdrawn: "muted" };
const DID = { to_approve: "entered it", approved: "approved it", sending: "started writing it into Tally",
              done: "wrote it into Tally", failed: "could not write it", rejected: "rejected it", withdrawn: "withdrew it" };

export default function Entries() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const { data, error, loading, reload } = useApi(`/api/changes?page=${page}`);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  useEffect(() => { document.title = "Entries · SNJ Orders"; }, []);

  const act = async (id, what) => {
    setBusy(`${id}:${what}`);
    setActionError(null);
    try {
      await api(`/api/changes/${id}/${what}`, { method: "POST" });
    } catch (e) {
      setActionError(e.message);
    }
    await reload();
    setBusy(null);
  };

  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title="Entries" subtitle="New orders entered here, and where each one is on its way into Tally."
                  actions={<Link to="/new-order" className="btn btn-primary">+ New order</Link>} />
      <Alert>{error}</Alert>
      <Alert onClose={() => setActionError(null)}>{actionError}</Alert>
      {!data ? <div className="entries">{[1, 2, 3].map((i) => <div key={i} className="card card-pad"><Skeleton width="50%" /></div>)}</div>
        : !data.changes.length ? <EmptyState title="Nothing entered yet"><Link to="/new-order">Enter the first order</Link></EmptyState>
          : (
            <div className={`entries ${loading ? "is-loading" : ""}`}>
              {data.changes.map((c) => (
                <details className="card entry" key={c.id} open={c.status === "to_approve" || c.status === "failed"}>
                  <summary>
                    <span className="entry-title"><strong>{c.order.order_no}</strong><span className="muted"> · {c.order.party}</span></span>
                    <span className="muted nowrap">{niceTime(c.created_at)} · {c.created_by}</span>
                    <span className="num strong">₹{inr(c.total)}</span>
                    <Badge tone={TONE[c.status]}>{c.status_label}</Badge>
                  </summary>
                  <div className="entry-body">
                    {c.error && <Alert>{c.error}</Alert>}
                    <p className="muted">Order date {niceDate(c.order.date)}{c.order.reference && ` · Ref ${c.order.reference}`}
                      {c.order.narration && ` · ${c.order.narration}`}</p>
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>Item</th><th>Size</th><th className="num">Qty</th><th className="num">Rate ₹</th><th>Discount</th><th>Due</th></tr></thead>
                        <tbody>
                          {c.order.lines.flatMap((l, i) => l.sizes.map((s, k) => (
                            <tr key={`${i}-${k}`}>
                              <td data-label="Item">{l.item}</td><td data-label="Size">{s.size || "—"}</td>
                              <td data-label="Qty" className="num">{qty(s.qty)} {l.unit}</td>
                              <td data-label="Rate ₹" className="num">{inr(l.rate)}</td>
                              <td data-label="Discount">{l.discount === "none" ? "None" : "50% + 20%"}</td>
                              <td data-label="Due" className="nowrap">{niceDate(s.due_date)}</td>
                            </tr>
                          )))}
                        </tbody>
                      </table>
                    </div>
                    <ol className="timeline">
                      {c.history.map((h, i) => (
                        <li key={i} className={`tl-${TONE[h.status]}`}>
                          <span className="strong">{h.by === "bridge" ? "Bridge" : h.by}</span> {DID[h.status]}
                          <span className="muted"> · {niceTime(h.at)}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="entry-actions">
                      {data.can_approve && c.status === "to_approve" && <>
                        <Button size="sm" loading={busy === `${c.id}:approve`} disabled={!!busy} onClick={() => act(c.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="secondary" loading={busy === `${c.id}:reject`} disabled={!!busy} onClick={() => act(c.id, "reject")}>Reject</Button>
                      </>}
                      {["to_approve", "approved"].includes(c.status) &&
                        <Button size="sm" variant="ghost" loading={busy === `${c.id}:withdraw`} disabled={!!busy} onClick={() => act(c.id, "withdraw")}>Withdraw</Button>}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} perPage={data.per_page}
                           disabled={loading} onPage={(n) => setParams({ page: String(n) })} />}
    </>
  );
}
