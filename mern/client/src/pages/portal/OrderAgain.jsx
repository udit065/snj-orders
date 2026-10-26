import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import { niceDate, qty as fmtQty } from "../../format.js";
import { Alert, Button, Card, Field, PageHeader, Skeleton } from "../../components/ui.jsx";

export default function OrderAgain() {
  const { guid } = useParams();
  const { data, error: loadError } = useApi(`/api/order/${encodeURIComponent(guid)}`);
  const [qtys, setQtys] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { document.title = "Order again · SNJ"; }, []);
  const sizes = data ? data.items.flatMap((g) => g.sizes.map((l) => ({ ...l, unit: g.unit }))) : [];
  useEffect(() => { if (data) setQtys(sizes.map((l) => String(l.qty))); }, [data]);  // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines = sizes.map((l, i) => ({ item: l.item, size: l.size, qty: Number(qtys[i]) || 0 }));
      await api("/api/my/repeat", { method: "POST", body: JSON.stringify({ guid, lines, note }) });
      navigate("/send-order?sent=1");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!data || !qtys) return <Card><Skeleton width="40%" height={24} /><p /><Skeleton /></Card>;
  const wanted = qtys.filter((q) => Number(q) > 0).length;

  return (
    <form onSubmit={send}>
      <PageHeader back={<Link className="back" to={`/order/${encodeURIComponent(guid)}`}>← Order {data.order.number}</Link>}
                  title="Order again" subtitle={`Same items as ${data.order.number} of ${niceDate(data.order.date)}. Change any quantity, or make it 0 to leave it out.`} />
      <Alert onClose={() => setError(null)}>{error}</Alert>
      <Card padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th>Size</th><th className="num">Last time</th><th className="num">This time</th></tr></thead>
            <tbody>
              {sizes.map((l, i) => (
                <tr key={l.idx}>
                  <td data-label="Item">{l.item}</td>
                  <td data-label="Size">{l.size || "—"}</td>
                  <td data-label="Last time" className="num">{fmtQty(l.qty)} {l.unit}</td>
                  <td data-label="This time" className="num">
                    <input className="qty-input" type="number" inputMode="decimal" min="0" step="any" value={qtys[i]}
                           aria-label={`Quantity of ${l.item} ${l.size}`}
                           onChange={(e) => setQtys(qtys.map((q, j) => (j === i ? e.target.value : q)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <Field label="Anything to add?" hint="Optional, e.g. urgent, or a different transport">
          <textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="card-foot">
          <span className="muted small">SNJ checks it and enters it, like an order photo.</span>
          <Button type="submit" loading={busy} disabled={!wanted}>Send {wanted} item size{wanted === 1 ? "" : "s"} to SNJ</Button>
        </div>
      </Card>
    </form>
  );
}
