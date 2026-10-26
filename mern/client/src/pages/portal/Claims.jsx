import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import { niceDate, niceTime, qty } from "../../format.js";
import { toDataUrl } from "../../photo.js";
import PhotoPicker from "../../components/PhotoPicker.jsx";
import { Alert, Badge, Button, Card, EmptyState, Field, NOTICE_TONE, PageHeader, Skeleton } from "../../components/ui.jsx";

const blank = { party: "", order_guid: "", item: "", qty: "", problem: "Damaged", note: "" };

export default function Claims() {
  const { data, error: loadError, reload } = useApi("/api/my/claims");
  const [form, setForm] = useState(blank);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { document.title = "Damage claims · SNJ"; }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const party = form.party || data?.parties[0];
  const orders = (data?.orders || []).filter((o) => o.party === party);
  const order = orders.find((o) => o.guid === form.order_guid);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, party, photos: await Promise.all(photos.map((p) => toDataUrl(p.blob))) };
      await api("/api/my/claims", { method: "POST", body: JSON.stringify(body) });
      setForm(blank);
      setPhotos([]);
      setSent(true);
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Report a problem with goods" subtitle="Damaged, short or wrong goods? Send photos and SNJ will sort it out." />
      <Card>
        <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
        {sent && <Alert tone="info" onClose={() => setSent(false)}>Sent. SNJ will look at it and reply below.</Alert>}
        {!data ? <Skeleton /> : (
          <form className="notice-form" onSubmit={send}>
            {data.parties.length > 1 && (
              <Field label="For which account">
                <select value={party} onChange={(e) => setForm({ ...form, party: e.target.value, order_guid: "" })}>
                  {data.parties.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
            )}
            <Field label="What went wrong">
              <div className="choices">
                {data.problems.map((p) => (
                  <button key={p} type="button" className={`choice ${form.problem === p ? "on" : ""}`}
                          onClick={() => setForm({ ...form, problem: p })}>{p}</button>
                ))}
              </div>
            </Field>
            <Field label="Which order" hint="Optional">
              <select value={form.order_guid} onChange={set("order_guid")}>
                <option value="">Not sure</option>
                {orders.map((o) => <option key={o.guid} value={o.guid}>{o.number} · {niceDate(o.date)}</option>)}
              </select>
            </Field>
            <div className="form-row">
              <Field label="Item">
                <input list="claim-items" value={form.item} maxLength={120} onChange={set("item")} placeholder="e.g. NIKER S-XL" />
                <datalist id="claim-items">{(order?.items || []).map((i) => <option key={i} value={i} />)}</datalist>
              </Field>
              <Field label="How many" hint="Pieces or dozens"><input inputMode="decimal" value={form.qty} onChange={set("qty")} /></Field>
            </div>
            <Field label="Photos" hint="Up to 3: the goods, the box and the label help most">
              <PhotoPicker photos={photos} onChange={setPhotos} max={3} />
            </Field>
            <Field label="Tell us more" hint="Optional">
              <textarea rows={2} value={form.note} maxLength={500} onChange={set("note")} />
            </Field>
            <div><Button type="submit" loading={busy} disabled={!photos.length}>Send to SNJ</Button></div>
          </form>
        )}
      </Card>
      <Card title="Your reports" padded={false}>
        {!data ? <div className="card-pad"><Skeleton /></div>
          : !data.claims.length ? <EmptyState title="None yet" />
            : (
              <ul className="list">
                {data.claims.map((c) => (
                  <li key={c.id}>
                    <a href={`/api/notices/${c.id}/photo/0`} target="_blank" rel="noreferrer" className="thumb">
                      <img src={`/api/notices/${c.id}/photo/0`} alt="Claim photo" loading="lazy" />
                    </a>
                    <div className="grow">
                      <div className="strong">{c.problem}{c.item && ` · ${c.item}`}{c.qty > 0 && ` × ${qty(c.qty)}`}</div>
                      <div className="muted small">{niceTime(c.created_at)}
                        {c.order && <> · order <Link to={`/order/${encodeURIComponent(c.order.guid)}`}>{c.order.number}</Link></>}
                        {c.staff_note && <span className={c.status === "rejected" ? "late" : ""}> · SNJ: {c.staff_note}</span>}</div>
                    </div>
                    <Badge tone={NOTICE_TONE[c.status]}>{c.stage_label}</Badge>
                  </li>
                ))}
              </ul>
            )}
      </Card>
    </>
  );
}
