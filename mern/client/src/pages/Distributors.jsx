import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { niceTime } from "../format.js";
import DataTable from "../components/DataTable.jsx";
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader } from "../components/ui.jsx";

const blank = { phone: "", name: "", parties: [], password: "", active: true, existing: false };

export default function Distributors() {
  const { data, error: loadError, loading, reload } = useApi("/api/distributors");
  const [form, setForm] = useState(blank);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => { document.title = "Distributors · SNJ Orders"; }, []);
  const known = useMemo(() => new Set(data?.parties || []), [data]);

  const addParty = (name) => {
    if (known.has(name) && !form.parties.includes(name)) setForm({ ...form, parties: [...form.parties, name] });
    setPick("");
  };
  const edit = (d) => {
    setForm({ ...d, password: "", existing: true });
    setSaved(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { existing, ...body } = form;  // eslint-disable-line no-unused-vars
      const d = await api("/api/distributors", { method: "POST", body: JSON.stringify(body) });
      setSaved(`Saved. ${d.name} signs in with ${d.phone}${form.password ? " and the password you set" : ""}.`);
      setForm(blank);
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Distributors" subtitle="Logins for the distributor portal. Each one sees only the Tally customers linked to it." />
      <Card title={form.existing ? `Change ${form.name}` : "Add a distributor"}
            actions={form.existing && <Button size="sm" variant="ghost" onClick={() => setForm(blank)}>Cancel</Button>}>
        <Alert onClose={() => setError(null)}>{error || loadError}</Alert>
        <Alert tone="info" onClose={() => setSaved(null)}>{saved}</Alert>
        <form onSubmit={save} className="dist-form">
          <div className="form-grid">
            <Field label="Mobile number" hint="They sign in with this">
              <input value={form.phone} required inputMode="tel" disabled={form.existing} placeholder="98310 40404"
                     onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Name"><input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={form.existing ? "New password" : "Password"} hint={form.existing ? "Leave empty to keep the old one" : "At least 8 characters; tell it to them"}>
              <input value={form.password} minLength={8} required={!form.existing} autoComplete="new-password"
                     onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Login">
              <select value={form.active ? "on" : "off"} onChange={(e) => setForm({ ...form, active: e.target.value === "on" })}>
                <option value="on">Can sign in</option><option value="off">Switched off</option>
              </select>
            </Field>
          </div>
          <Field label="Tally customers they see" hint="Start typing the name as it is in Tally">
            <input list="tally-customers" value={pick} placeholder="Customer name"
                   onChange={(e) => (known.has(e.target.value) ? addParty(e.target.value) : setPick(e.target.value))} />
            <datalist id="tally-customers">{(data?.parties || []).map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <div className="chips">
            {form.parties.map((p) => (
              <span key={p} className="chip">{p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => setForm({ ...form, parties: form.parties.filter((x) => x !== p) })}>×</button>
              </span>
            ))}
            {!form.parties.length && <span className="muted small">No customers linked yet</span>}
          </div>
          <div><Button type="submit" loading={busy}>{form.existing ? "Save changes" : "Add distributor"}</Button></div>
        </form>
      </Card>
      <Card title="Distributor logins" padded={false}>
        <DataTable rows={data?.distributors} rowKey={(d) => d.phone} loading={loading} onRowClick={edit}
          columns={[
            { key: "name", label: "Name", className: () => "strong" },
            { key: "phone", label: "Mobile" },
            { key: "parties", label: "Tally customers", render: (d) => d.parties.join(", ") },
            { key: "active", label: "Login", render: (d) => <Badge tone={d.active ? "ok" : "muted"}>{d.active ? "Can sign in" : "Off"}</Badge> },
            { key: "created_at", label: "Added", render: (d) => (d.created_at ? niceTime(d.created_at) : "—"), className: () => "nowrap" },
          ]}
          empty={<EmptyState title="No distributors yet">Add the first one above.</EmptyState>} />
      </Card>
    </>
  );
}
