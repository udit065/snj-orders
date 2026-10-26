import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.js";
import { inr, niceTime } from "../format.js";
import DataTable from "../components/DataTable.jsx";
import { SearchBox, SegmentedFilter } from "../components/Filters.jsx";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat, TopProgress } from "../components/ui.jsx";

// Staff: who owes what, most overdue first.
export default function Accounts() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const show = params.get("show") || "owing";
  const { data, error, loading } = useApi(`/api/accounts?${new URLSearchParams({ q, show })}`);
  const navigate = useNavigate();
  useEffect(() => { document.title = "Accounts · SNJ Orders"; }, []);
  const update = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  };
  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title="Accounts" subtitle={`Customers' balances from Tally${data?.as_of ? `, as of ${niceTime(data.as_of)}` : ""}. Click one for bills and statement.`} />
      {data && <div className="stats">
        <Stat label="Total owed" value={`₹${inr(data.total_balance)}`}>{data.total} customers</Stat>
        <Stat label="Overdue" value={`₹${inr(data.total_overdue)}`} tone={data.total_overdue ? "late" : ""}>past the due date</Stat>
      </div>}
      <Card padded={false}>
        <div className="toolbar"><SearchBox value={q} onChange={(v) => update("q", v)} placeholder="Search customer" /></div>
        <div className="toolbar toolbar-tabs">
          <SegmentedFilter value={show} onChange={(v) => update("show", v === "owing" ? "" : v)}
                           options={[{ value: "owing", label: "Owe money" }, { value: "all", label: "All customers" }]} />
        </div>
        <Alert>{error}</Alert>
        <DataTable rows={data?.accounts} rowKey={(a) => a.party} loading={loading}
          onRowClick={(a) => navigate(`/account?party=${encodeURIComponent(a.party)}`)}
          columns={[
            { key: "party", label: "Customer" },
            { key: "balance", label: "Balance ₹", align: "right", render: (a) => inr(a.balance) },
            { key: "overdue", label: "Overdue ₹", align: "right", render: (a) => (a.overdue ? inr(a.overdue) : "—"), className: (a) => (a.overdue ? "late" : "") },
            { key: "oldest", label: "Oldest late", align: "right", render: (a) => (a.oldest_overdue_days ? `${a.oldest_overdue_days} days` : "—") },
            { key: "limit", label: "Credit limit ₹", align: "right", render: (a) => (a.credit_limit ? <>{inr(a.credit_limit)}{a.over_limit && <> <Badge tone="bad">over</Badge></>}</> : "—") },
            { key: "confirmed", label: "Balance confirmed", render: (a) => (!a.confirmed ? "—"
              : a.confirmed.agree ? <Badge tone="ok">Yes</Badge> : <span title={a.confirmed.note}><Badge tone="warn">Differs</Badge></span>) },
          ]}
          empty={<EmptyState title={data?.total === 0 && !q ? "Nothing from Tally yet" : "No customers here"}>
            {data?.total === 0 && !q ? "Balances appear once the bridge on the Tally server has the accounts update." : "Try another search."}</EmptyState>} />
      </Card>
    </>
  );
}
