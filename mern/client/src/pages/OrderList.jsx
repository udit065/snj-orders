import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { inr, niceDate } from "../format.js";

export default function OrderList({ load }) {
  const { kind } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const sales = kind === "sales";
  const status = params.get("status") || "open";

  useEffect(() => {
    document.title = `${sales ? "Sales" : "Purchase"} orders · SNJ Orders`;
    setError(null);
    load(`/api/orders/${kind}?${params}`).then(setData).catch((e) => setError(e.message));
  }, [kind, params, load, sales]);

  const submit = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setParams(Object.fromEntries([...form].filter(([, v]) => v)));
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const c = data.counts;
  const options = [
    ["open", `Not completed (${c.pending + c.partly})`], ["pending", `Pending (${c.pending})`],
    ["partly", `Partly done (${c.partly})`], ["done", `Completed (${c.done})`],
    ["cancelled", `Cancelled (${c.cancelled})`], ["all", "All"],
  ];

  return (
    <>
      <h1>{sales ? "Sales" : "Purchase"} orders</h1>
      <form className="filters" onSubmit={submit} key={`${kind}?${params}`}>
        <input name="q" defaultValue={params.get("q") || ""}
               placeholder={`Search ${sales ? "customer" : "supplier"}, order no. or item`} />
        <select name="status" defaultValue={status}>
          {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label className="d">From <input type="date" name="date_from" defaultValue={params.get("date_from") || ""} /></label>
        <label className="d">To <input type="date" name="date_to" defaultValue={params.get("date_to") || ""} /></label>
        <button>Show</button>
      </form>
      {!data.orders.length ? <p className="muted">No orders match.</p> : (
        <table className="list">
          <thead><tr>
            <th>Date</th><th>Order no.</th><th>{sales ? "Customer" : "Supplier"}</th><th className="n">Items</th>
            <th className="n">Amount ₹</th><th>Next due</th><th>Status</th>
          </tr></thead>
          <tbody>
            {data.orders.map((o) => {
              const to = `/order/${encodeURIComponent(o.guid)}`;
              return (
                <tr key={o.guid} onClick={() => navigate(to)}>
                  <td data-l="Date">{niceDate(o.date)}</td>
                  <td data-l="Order no."><Link to={to}>{o.number}</Link>{o.optional && <> <span className="tag">optional</span></>}</td>
                  <td data-l="Party">{o.party}</td>
                  <td data-l="Items" className="n">{o.items}</td>
                  <td data-l="Amount ₹" className="n">{inr(o.total)}</td>
                  <td data-l="Next due" className={o.overdue ? "late" : ""}>{niceDate(o.next_due)}</td>
                  <td data-l="Status"><span className={`st ${o.status}`}>{o.status_label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
