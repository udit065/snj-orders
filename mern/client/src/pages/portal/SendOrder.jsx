import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { upload } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import { niceTime } from "../../format.js";
import { fileSize, shrinkPhoto } from "../../photo.js";
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, PHOTO_TONE, Skeleton } from "../../components/ui.jsx";
import { useT } from "../../i18n.jsx";

export default function SendOrder() {
  const t = useT();
  const { data, error: loadError, reload } = useApi("/api/my/photos");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [note, setNote] = useState("");
  const [party, setParty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [params] = useSearchParams();
  const [sent, setSent] = useState(params.get("sent") === "1");
  const input = useRef(null);
  useEffect(() => { document.title = "Send an order · SNJ"; }, []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pick = async (e) => {
    const chosen = e.target.files[0];
    e.target.value = "";
    if (!chosen) return;
    setError(null);
    setSent(false);
    const small = await shrinkPhoto(chosen);
    setFile(small);
    setPreview(URL.createObjectURL(small));
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({ note, party: party || data.parties[0] });
      await upload(`/api/my/photos?${query}`, file);
      setFile(null);
      setPreview("");
      setNote("");
      setSent(true);
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title={t("Send an order")} subtitle={t("Write your order on your usual pad and send a photo. SNJ enters it the same day.")} />
      <Card>
        <Alert>{error || loadError}</Alert>
        {sent && <Alert tone="info" onClose={() => setSent(false)}>{t("Sent. You can follow it below.")}</Alert>}
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        {!file ? (
          <button type="button" className="photo-drop" onClick={() => input.current.click()}>
            <span className="photo-drop-icon" aria-hidden="true">📷</span>
            <span className="strong">{t("Photograph your order pad")}</span>
            <span className="muted small">{t("or choose a photo you already took")}</span>
          </button>
        ) : (
          <div className="photo-ready">
            <img src={preview} alt="Your order pad" />
            <div className="photo-form">
              <p className="muted small">{fileSize(file.size)} · <button type="button" className="link-btn" onClick={() => input.current.click()}>{t("Take another")}</button></p>
              {data?.parties.length > 1 && (
                <Field label={t("For which account")}>
                  <select value={party || data.parties[0]} onChange={(e) => setParty(e.target.value)}>
                    {data.parties.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t("Anything to add?")} hint={t("Optional, e.g. urgent, or send by a certain transport")}>
                <textarea rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button onClick={send} loading={busy} disabled={!data}>{t("Send to SNJ")}</Button>
            </div>
          </div>
        )}
      </Card>
      <Card title={t("Your order requests")} padded={false}>
        {!data ? <div className="card-pad"><Skeleton /></div>
          : !data.photos.length ? <EmptyState title={t("None yet")} />
            : (
              <ul className="list">
                {data.photos.map((p) => (
                  <li key={p.id}>
                    {p.kind === "repeat" ? <span className="thumb thumb-icon" aria-hidden="true">↻</span> : (
                      <a href={`/api/photos/${p.id}/image`} target="_blank" rel="noreferrer" className="thumb">
                        <img src={`/api/photos/${p.id}/image`} alt="Order photo" loading="lazy" />
                      </a>
                    )}
                    <div className="grow">
                      <div className="strong">{niceTime(p.created_at)}</div>
                      <div className="muted small">
                        {p.order_guid ? <>{t("Order")} <Link to={`/order/${encodeURIComponent(p.order_guid)}`}>{p.order_no}</Link></>
                          : p.order_no ? t("Order {n}", { n: p.order_no })
                            : p.kind === "repeat" ? t("Order again of {n}", { n: p.from_order?.number }) : p.note}
                        {p.stage === "rejected" && <span className="late"> {p.staff_note}</span>}
                      </div>
                    </div>
                    <Badge tone={PHOTO_TONE[p.stage]}>{t(p.stage_label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
      </Card>
    </>
  );
}
