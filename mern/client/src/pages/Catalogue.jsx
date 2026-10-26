import { useEffect, useState } from "react";
import { api, upload } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { niceTime } from "../format.js";
import { fileSize } from "../photo.js";
import { Alert, Button, Card, EmptyState, Field, PageHeader, Skeleton } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";

export default function Catalogue() {
  const t = useT();
  const { data, error: loadError, reload } = useApi("/api/catalogue");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { document.title = "Catalogue · SNJ"; }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy("add");
    setError(null);
    try {
      await upload(`/api/catalogue?${new URLSearchParams({ title })}`, file, "application/pdf");
      setTitle("");
      setFile(null);
      e.target.reset();
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove "${c.title}"? Distributors will no longer see it.`)) return;
    setBusy(c.id);
    try {
      await api(`/api/catalogue/${c.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };

  return (
    <>
      <PageHeader title={t("Catalogue")} subtitle={data?.can_upload ? "PDFs every distributor sees in their portal" : t("The latest from SNJ")} />
      <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
      {data?.can_upload && (
        <Card title="Add a catalogue">
          <form className="inline-form" onSubmit={add}>
            <Field label="Name"><input value={title} required maxLength={120} placeholder="e.g. Festive Collection 2026"
                                       onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="PDF file" hint="Up to 25 MB"><input type="file" accept="application/pdf" required
                                                             onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
            <Button type="submit" loading={busy === "add"}>Upload</Button>
          </form>
        </Card>
      )}
      {!data ? <Card><Skeleton /></Card>
        : !data.catalogues.length ? <EmptyState title={t("No catalogues yet")}>{data.can_upload ? "Upload the first one above." : t("New collections will appear here.")}</EmptyState>
          : (
            <div className="catalogue-grid">
              {data.catalogues.map((c) => (
                <div key={c.id} className="card card-pad catalogue-item">
                  <span className="pdf-mark" aria-hidden="true">PDF</span>
                  <div className="grow">
                    <div className="strong">{c.title}</div>
                    <div className="muted small">{fileSize(c.size)} · added {niceTime(c.created_at)}</div>
                  </div>
                  <div className="catalogue-actions">
                    <a className="btn btn-secondary btn-sm" href={`/api/catalogue/${c.id}/file`} target="_blank" rel="noreferrer">{t("Open")}</a>
                    {data.can_upload && <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => remove(c)}>Remove</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
    </>
  );
}
