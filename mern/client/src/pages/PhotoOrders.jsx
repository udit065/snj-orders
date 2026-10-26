import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { niceTime } from "../format.js";
import { SegmentedFilter } from "../components/Filters.jsx";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, PHOTO_TONE, Skeleton, TopProgress } from "../components/ui.jsx";

// Staff words for where a photo is; distributors see the server's own wording.
const STAGE = { received: "To enter", entered: "Entered", done: "In Tally", rejected: "Sent back" };

export default function PhotoOrders() {
  const [params, setParams] = useSearchParams();
  const show = params.get("show") || "open";
  const { data, error: loadError, loading, reload } = useApi(`/api/photo-orders?show=${show}`);
  const [rejecting, setRejecting] = useState(null);  // { id, note }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { document.title = "Order photos · SNJ Orders"; }, []);

  const reject = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/photo-orders/${rejecting.id}/reject`, { method: "POST", body: JSON.stringify({ note: rejecting.note }) });
      setRejecting(null);
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title="Order photos" subtitle="Order pads distributors photographed. Enter each one as an order, or send it back with a reason." />
      <Card padded={false}>
        <div className="toolbar toolbar-tabs">
          <SegmentedFilter value={show} onChange={(v) => setParams(v === "open" ? {} : { show: v })} options={[
            { value: "open", label: "To enter", count: data?.open },
            { value: "all", label: "All recent" },
          ]} />
        </div>
        <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
        {!data ? <div className="card-pad"><Skeleton /></div>
          : !data.photos.length ? <EmptyState title={show === "open" ? "Nothing to enter" : "No photos yet"}>
              {show === "open" && "New order photos from distributors appear here."}</EmptyState>
            : (
              <div className={`photo-grid ${loading ? "is-loading" : ""}`}>
                {data.photos.map((p) => (
                  <div key={p.id} className="photo-card">
                    <a href={`/api/photos/${p.id}/image`} target="_blank" rel="noreferrer" className="photo-img">
                      <img src={`/api/photos/${p.id}/image`} alt={`Order pad from ${p.party}`} loading="lazy" />
                    </a>
                    <div className="photo-body">
                      <div className="photo-title"><span className="strong">{p.party}</span>
                        <Badge tone={PHOTO_TONE[p.stage]}>{STAGE[p.stage]}</Badge></div>
                      <div className="muted small">{niceTime(p.created_at)} · from {p.username}</div>
                      {p.note && <p className="photo-note">“{p.note}”</p>}
                      {p.order_no && <div className="small">Order {p.order_guid
                        ? <Link to={`/order/${encodeURIComponent(p.order_guid)}`}>{p.order_no}</Link> : p.order_no}</div>}
                      {p.stage === "rejected" && <div className="small late">Sent back: {p.staff_note}</div>}
                      {p.stage === "received" && (rejecting?.id === p.id ? (
                        <div className="reject-form">
                          <input autoFocus placeholder="Why? e.g. photo is blurred" value={rejecting.note}
                                 onChange={(e) => setRejecting({ ...rejecting, note: e.target.value })} />
                          <div className="entry-actions">
                            <Button size="sm" variant="secondary" loading={busy} disabled={!rejecting.note.trim()} onClick={reject}>Send back</Button>
                            <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="entry-actions">
                          <Link className="btn btn-primary btn-sm" to={`/new-order?photo=${p.id}`}>Enter order</Link>
                          <Button size="sm" variant="ghost" onClick={() => setRejecting({ id: p.id, note: "" })}>Can't enter</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
      </Card>
    </>
  );
}
