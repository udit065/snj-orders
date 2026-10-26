import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { inr, niceDate, niceTime, qty } from "../format.js";
import { SegmentedFilter } from "../components/Filters.jsx";
import { Alert, Badge, Button, Card, EmptyState, NOTICE_TONE, PageHeader, Skeleton, TopProgress } from "../components/ui.jsx";

// Staff words for each kind; distributors see the server's own wording.
const KINDS = {
  payments: { title: "Payments told", what: "payment", stage: { open: "To check", accepted: "Confirmed", rejected: "Not found" },
              subtitle: "Payments distributors say they made. Check each against the bank, then confirm it or say it wasn't found.",
              accept: "Confirm", acceptHint: "Optional, e.g. receipt no.", reject: "Not found", rejectHint: "Why? e.g. no such UTR in the bank" },
  claims: { title: "Damage claims", what: "claim", stage: { open: "To check", accepted: "Accepted", rejected: "Not accepted" },
            subtitle: "Damaged, short or wrong goods reported with photos. Accept with what SNJ will do, or explain why not.",
            accept: "Accept", acceptHint: "What SNJ will do, e.g. credit note CN/12", reject: "Not accepted", rejectHint: "Why not?" },
};

export default function Notices() {
  const kinds = useLocation().pathname.includes("claims") ? "claims" : "payments";
  const k = KINDS[kinds];
  const [params, setParams] = useSearchParams();
  const show = params.get("show") || "open";
  const { data, error: loadError, loading, reload } = useApi(`/api/${kinds}?show=${show}`);
  const [deciding, setDeciding] = useState(null);  // { id, decision, note }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { document.title = `${k.title} · SNJ Orders`; setDeciding(null); }, [k]);

  const decide = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/${kinds}/${deciding.id}`, { method: "POST", body: JSON.stringify(deciding) });
      setDeciding(null);
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const list = data?.[kinds] || [];

  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={k.title} subtitle={k.subtitle} />
      <Card padded={false}>
        <div className="toolbar toolbar-tabs">
          <SegmentedFilter value={show} onChange={(v) => setParams(v === "open" ? {} : { show: v })} options={[
            { value: "open", label: "To check", count: data?.open },
            { value: "all", label: "All recent" },
          ]} />
          <Link className="small" to={kinds === "payments" ? "/claims" : "/payments"}>
            {kinds === "payments" ? "Damage claims" : "Payments told"}{data?.other_open ? ` (${data.other_open} to check)` : ""} →
          </Link>
        </div>
        <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
        {!data ? <div className="card-pad"><Skeleton /></div>
          : !list.length ? <EmptyState title={show === "open" ? "Nothing to check" : "None yet"} />
            : (
              <div className={`photo-grid ${loading ? "is-loading" : ""}`}>
                {list.map((n) => (
                  <div key={n.id} className="photo-card">
                    {n.photos > 0 && (
                      <div className="notice-photos">
                        {Array.from({ length: n.photos }, (_, i) => (
                          <a key={i} href={`/api/notices/${n.id}/photo/${i}`} target="_blank" rel="noreferrer">
                            <img src={`/api/notices/${n.id}/photo/${i}`} alt={`Photo ${i + 1} from ${n.party}`} loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="photo-body">
                      <div className="photo-title"><span className="strong">{n.party}</span>
                        <Badge tone={NOTICE_TONE[n.status]}>{k.stage[n.status]}</Badge></div>
                      {kinds === "payments" ? (
                        <div><span className="notice-amount">₹{inr(n.amount)}</span> <span className="muted">· {n.mode} on {niceDate(n.paid_on)}</span>
                          {n.reference && <div className="small">Ref: <span className="mono">{n.reference}</span></div>}</div>
                      ) : (
                        <div><span className="strong">{n.problem}</span>{n.item && ` · ${n.item}`}{n.qty > 0 && ` × ${qty(n.qty)}`}
                          {n.order && <div className="small">Order <Link to={`/order/${encodeURIComponent(n.order.guid)}`}>{n.order.number}</Link></div>}</div>
                      )}
                      <div className="muted small">Told {niceTime(n.created_at)} · from {n.username}</div>
                      {n.note && <p className="photo-note">“{n.note}”</p>}
                      {n.status !== "open" && n.staff_note && <div className={`small ${n.status === "rejected" ? "late" : ""}`}>SNJ: {n.staff_note}</div>}
                      {n.status === "open" && (deciding?.id === n.id ? (
                        <div className="reject-form">
                          <input autoFocus value={deciding.note} onChange={(e) => setDeciding({ ...deciding, note: e.target.value })}
                                 placeholder={deciding.decision === "accepted" ? k.acceptHint : k.rejectHint} />
                          <div className="entry-actions">
                            <Button size="sm" variant={deciding.decision === "accepted" ? "primary" : "secondary"} loading={busy}
                                    disabled={deciding.decision === "rejected" && !deciding.note.trim()} onClick={decide}>
                              {deciding.decision === "accepted" ? k.accept : k.reject}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="entry-actions">
                          <Button size="sm" onClick={() => setDeciding({ id: n.id, decision: "accepted", note: "" })}>{k.accept}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeciding({ id: n.id, decision: "rejected", note: "" })}>{k.reject}</Button>
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
