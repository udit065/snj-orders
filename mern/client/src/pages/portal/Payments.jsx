import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import { inr, niceDate, niceTime } from "../../format.js";
import { toDataUrl } from "../../photo.js";
import PhotoPicker from "../../components/PhotoPicker.jsx";
import { Alert, Badge, Button, Card, EmptyState, Field, NOTICE_TONE, PageHeader, Skeleton } from "../../components/ui.jsx";

const REF_LABEL = { UPI: "UTR / transaction no.", "NEFT / RTGS": "UTR no.", Cheque: "Cheque no.", Other: "Reference" };
const blank = (today) => ({ party: "", amount: "", paid_on: today, mode: "UPI", reference: "", note: "" });

export default function Payments() {
  const { data, error: loadError, reload } = useApi("/api/my/payments");
  const [form, setForm] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { document.title = "Payments · SNJ"; }, []);
  useEffect(() => { if (data && !form) setForm(blank(data.today)); }, [data, form]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, party: form.party || data.parties[0],
                     photos: await Promise.all(photos.map((p) => toDataUrl(p.blob))) };
      await api("/api/my/payments", { method: "POST", body: JSON.stringify(body) });
      setForm(blank(data.today));
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
      <PageHeader title="Tell us you've paid" subtitle="Paid by UPI, bank transfer or cheque? Tell SNJ here so your account is updated sooner." />
      <Card>
        <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
        {sent && <Alert tone="info" onClose={() => setSent(false)}>Thank you. SNJ will check it with the bank and confirm below.</Alert>}
        {!form ? <Skeleton /> : (
          <form className="notice-form" onSubmit={send}>
            {data.parties.length > 1 && (
              <Field label="For which account">
                <select value={form.party || data.parties[0]} onChange={set("party")}>
                  {data.parties.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
            )}
            <div className="form-row">
              <Field label="Amount ₹"><input inputMode="decimal" required value={form.amount} onChange={set("amount")} placeholder="e.g. 25000" /></Field>
              <Field label="Paid on"><input type="date" required max={data.today} value={form.paid_on} onChange={set("paid_on")} /></Field>
            </div>
            <div className="form-row">
              <Field label="How">
                <select value={form.mode} onChange={set("mode")}>{data.modes.map((m) => <option key={m}>{m}</option>)}</select>
              </Field>
              {form.mode !== "Cash" && (
                <Field label={REF_LABEL[form.mode]}><input required value={form.reference} maxLength={60} onChange={set("reference")} /></Field>
              )}
            </div>
            <Field label="Screenshot or cheque photo" hint="Optional, but it helps SNJ find your payment faster">
              <PhotoPicker photos={photos} onChange={setPhotos} label="Add a screenshot" />
            </Field>
            <Field label="Anything to add?" hint="Optional, e.g. which bills it is for">
              <textarea rows={2} value={form.note} maxLength={500} onChange={set("note")} />
            </Field>
            <div><Button type="submit" loading={busy}>Tell SNJ</Button></div>
          </form>
        )}
      </Card>
      <Card title="Payments you told us about" padded={false}>
        {!data ? <div className="card-pad"><Skeleton /></div>
          : !data.payments.length ? <EmptyState title="None yet" />
            : (
              <ul className="list">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    <div className="grow">
                      <div className="strong">₹{inr(p.amount)} <span className="muted">· {p.mode}</span></div>
                      <div className="muted small">Paid {niceDate(p.paid_on)}{p.reference && ` · ${p.reference}`} · told {niceTime(p.created_at)}
                        {p.staff_note && <span className={p.status === "rejected" ? "late" : ""}> · SNJ: {p.staff_note}</span>}</div>
                    </div>
                    <Badge tone={NOTICE_TONE[p.status]}>{p.stage_label}</Badge>
                  </li>
                ))}
              </ul>
            )}
      </Card>
    </>
  );
}
