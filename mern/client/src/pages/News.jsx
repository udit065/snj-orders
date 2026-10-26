import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { toDataUrl } from "../photo.js";
import Contact from "../components/Contact.jsx";
import PhotoPicker from "../components/PhotoPicker.jsx";
import PostCard from "../components/PostCard.jsx";
import { Alert, Button, Card, EmptyState, Field, PageHeader, Skeleton } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";

const blank = { kind: "offer", title: "", body: "", until: "" };

export default function News() {
  const t = useT();
  const { data, error: loadError, reload } = useApi("/api/news");
  const [form, setForm] = useState(blank);
  const [photos, setPhotos] = useState([]);
  const [contact, setContact] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => { document.title = "What's new · SNJ"; }, []);
  useEffect(() => { if (data && !contact) setContact({ name: "", phone: "", whatsapp: "", email: "", hours: "", ...data.contact }); }, [data, contact]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setC = (k) => (e) => setContact({ ...contact, [k]: e.target.value });

  const run = async (what, fn) => {
    setBusy(what);
    setError(null);
    setSaved(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  };
  const post = (e) => {
    e.preventDefault();
    run("post", async () => {
      const photo = photos[0] ? await toDataUrl(photos[0].blob) : "";
      await api("/api/news", { method: "POST", body: JSON.stringify({ ...form, photo }) });
      setForm(blank);
      setPhotos([]);
      setSaved("Posted. Distributors see it on their Home page.");
    });
  };
  const remove = (p) => window.confirm(`Remove "${p.title}"?`) && run(p.id, () => api(`/api/news/${p.id}`, { method: "DELETE" }));
  const saveContact = (e) => {
    e.preventDefault();
    run("contact", async () => {
      await api("/api/contact", { method: "POST", body: JSON.stringify(contact) });
      setSaved("Contact saved.");
    });
  };

  if (!data) return loadError ? <Alert>{loadError}</Alert> : <Card><Skeleton /></Card>;
  return (
    <>
      <PageHeader title={data.can_post ? "News and offers" : t("What's new")}
                  subtitle={data.can_post ? "Schemes, offers and news every distributor sees" : t("Schemes, offers and news from SNJ")} />
      <Alert onClose={() => setError(null)}>{error}</Alert>
      {saved && <Alert tone="info" onClose={() => setSaved(null)}>{saved}</Alert>}
      {data.can_post && (
        <div className="home-grid">
          <Card title="Post something">
            <form className="notice-form" onSubmit={post}>
              <div className="choices">
                {[["offer", "Scheme / offer"], ["news", "News"]].map(([k, label]) => (
                  <button key={k} type="button" className={`choice ${form.kind === k ? "on" : ""}`} onClick={() => setForm({ ...form, kind: k })}>{label}</button>
                ))}
              </div>
              <Field label="Heading"><input required maxLength={120} value={form.title} onChange={set("title")}
                                            placeholder={form.kind === "offer" ? "e.g. Diwali scheme: 5% extra on 100 doz" : "e.g. New thermal range is here"} /></Field>
              <Field label="Details" hint="Optional"><textarea rows={3} maxLength={2000} value={form.body} onChange={set("body")} /></Field>
              {form.kind === "offer" && <Field label="Valid till" hint="Optional; it disappears after this date">
                <input type="date" min={data.today} value={form.until} onChange={set("until")} /></Field>}
              <Field label="Picture" hint="Optional"><PhotoPicker photos={photos} onChange={setPhotos} label="Add a picture" /></Field>
              <div><Button type="submit" loading={busy === "post"}>Post</Button></div>
            </form>
          </Card>
          <Card title="How distributors reach SNJ">
            {contact && (
              <form className="notice-form" onSubmit={saveContact}>
                <Field label="Name" hint="e.g. Rohit, sales"><input value={contact.name} maxLength={120} onChange={setC("name")} /></Field>
                <div className="form-row">
                  <Field label="Phone"><input inputMode="tel" value={contact.phone} onChange={setC("phone")} /></Field>
                  <Field label="WhatsApp"><input inputMode="tel" value={contact.whatsapp} onChange={setC("whatsapp")} /></Field>
                </div>
                <Field label="Email"><input type="email" value={contact.email} onChange={setC("email")} /></Field>
                <Field label="Hours" hint="e.g. Mon-Sat, 10 am to 7 pm"><input value={contact.hours} maxLength={120} onChange={setC("hours")} /></Field>
                <div><Button type="submit" variant="secondary" loading={busy === "contact"}>Save contact</Button></div>
              </form>
            )}
          </Card>
        </div>
      )}
      {!data.can_post && <Contact contact={data.contact} />}
      {!data.posts.length ? <EmptyState title={t("Nothing yet")}>{data.can_post ? "Post the first scheme or news above." : t("New schemes and news from SNJ will appear here.")}</EmptyState> : (
        <div className="post-grid">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p}>
              {data.can_post && <div><Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => remove(p)}>Remove</Button>
                {p.until && p.until < data.today && <span className="muted small"> · ended, distributors no longer see it</span>}</div>}
            </PostCard>
          ))}
        </div>
      )}
    </>
  );
}
