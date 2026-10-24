import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.js";
import { inr, niceDate } from "../format.js";
import DataTable from "../components/DataTable.jsx";
import Pagination from "../components/Pagination.jsx";
import { DateRange, SearchBox, SegmentedFilter } from "../components/Filters.jsx";
import { Alert, Badge, Card, EmptyState, PageHeader, STATUS_TONE, TopProgress } from "../components/ui.jsx";

export default function OrderList() {
  const { kind } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sales = kind === "sales";
  const q = params.get("q") || "";
  const status = params.get("status") || "open";
  const from = params.get("date_from") || "";
  const to = params.get("date_to") || "";
  const page = Number(params.get("page")) || 1;

  const query = new URLSearchParams({ q, status, date_from: from, date_to: to, page, per_page: 50 });
  const { data, error, loading } = useApi(["sales", "purchase"].includes(kind) ? `/api/orders/${kind}?${query}` : null);

  useEffect(() => { document.title = `${sales ? "Sales" : "Purchase"} orders · SNJ Orders`; }, [sales]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);

  // Any filter change goes back to page 1.
  const update = (changes, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete("page");
    setParams(next);
  };

  if (!["sales", "purchase"].includes(kind)) return <EmptyState title="Page not found" />;
  const c = data?.counts;
  const party = sales ? "Customer" : "Supplier";
  const columns = [
    { key: "date", label: "Date", render: (o) => niceDate(o.date), className: () => "nowrap" },
    { key: "number", label: "Order no.", render: (o) => (
      <><Link to={`/order/${encodeURIComponent(o.guid)}`} onClick={(e) => e.stopPropagation()}>{o.number}</Link>
        {o.optional && <> <Badge tone="muted">optional</Badge></>}</>) },
    { key: "party", label: party, className: () => "strong" },
    { key: "items", label: "Items", align: "right" },
    { key: "total", label: "Amount ₹", align: "right", render: (o) => inr(o.total) },
    { key: "next_due", label: "Next due", render: (o) => niceDate(o.next_due) || "—",
      className: (o) => `nowrap ${o.overdue ? "late" : ""}` },
    { key: "status", label: "Status", render: (o) => <Badge tone={STATUS_TONE[o.status]}>{o.status_label}</Badge> },
  ];

  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={`${sales ? "Sales" : "Purchase"} orders`}
                  subtitle={sales ? "Orders from customers and what has been dispatched against them"
                                  : "Orders to suppliers and what has been received against them"} />
      <Card padded={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => update({ q: v })}
                     placeholder={`Search ${party.toLowerCase()}, order no. or item`} />
          <DateRange from={from} to={to} onChange={(f, t) => update({ date_from: f, date_to: t })} />
        </div>
        <div className="toolbar toolbar-tabs">
          <SegmentedFilter value={status} onChange={(v) => update({ status: v })} options={[
            { value: "open", label: "Not completed", count: c && c.pending + c.partly },
            { value: "pending", label: "Pending", count: c?.pending },
            { value: "partly", label: "Partly done", count: c?.partly },
            { value: "done", label: "Completed", count: c?.done },
            { value: "cancelled", label: "Cancelled", count: c?.cancelled },
            { value: "all", label: "All", count: c && c.pending + c.partly + c.done + c.cancelled },
          ]} />
        </div>
        <Alert>{error}</Alert>
        <DataTable columns={columns} rows={data?.orders} rowKey={(o) => o.guid} loading={loading}
                   onRowClick={(o) => navigate(`/order/${encodeURIComponent(o.guid)}`)}
                   mobileCard={(o) => (
                     <div className="order-card">
                       <span><Link to={`/order/${encodeURIComponent(o.guid)}`}>{o.number}</Link></span>
                       <span><Badge tone={STATUS_TONE[o.status]}>{o.status_label}</Badge></span>
                       <span className="oc-party">{o.party}</span>
                       <span className="oc-meta">{niceDate(o.date)} · {o.items} item{o.items === 1 ? "" : "s"}
                         {o.next_due && <> · due <span className={o.overdue ? "late" : ""}>{niceDate(o.next_due)}</span></>}</span>
                       <span className="oc-amount">₹{inr(o.total)}</span>
                     </div>
                   )}
                   empty={<EmptyState title="No orders match">Try another search, status or date range.</EmptyState>} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} perPage={data.per_page}
                             disabled={loading} onPage={(n) => update({ page: String(n) }, true)} />}
      </Card>
    </>
  );
}
