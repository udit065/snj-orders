import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../../hooks/useApi.js";
import { inr, niceDate } from "../../format.js";
import DataTable from "../../components/DataTable.jsx";
import Pagination from "../../components/Pagination.jsx";
import { SearchBox, SegmentedFilter } from "../../components/Filters.jsx";
import { Alert, Badge, Card, EmptyState, PageHeader, STATUS_TONE, TopProgress } from "../../components/ui.jsx";
import { useT } from "../../i18n.jsx";

export default function MyOrders() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") || "";
  const status = params.get("status") || "open";
  const page = Number(params.get("page")) || 1;
  const { data, error, loading } = useApi(`/api/my/orders?${new URLSearchParams({ q, status, page, per_page: 20 })}`);
  useEffect(() => { document.title = "Your orders · SNJ"; }, []);

  const update = (changes, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete("page");
    setParams(next);
  };
  const c = data?.counts;
  const open = (o) => navigate(`/order/${encodeURIComponent(o.guid)}`);

  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={t("Your orders")} subtitle={t("Every order, and what has been sent against it, size by size")} />
      <Card padded={false}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => update({ q: v })} placeholder={t("Search order no. or item")} />
        </div>
        <div className="toolbar toolbar-tabs">
          <SegmentedFilter value={status} onChange={(v) => update({ status: v })} options={[
            { value: "open", label: t("Still coming"), count: c && c.pending + c.partly },
            { value: "done", label: t("Fully sent"), count: c?.done },
            { value: "all", label: t("All"), count: c && c.pending + c.partly + c.done + c.cancelled },
          ]} />
        </div>
        <Alert>{error}</Alert>
        <DataTable rows={data?.orders} rowKey={(o) => o.guid} loading={loading} onRowClick={open}
          columns={[
            { key: "date", label: t("Date"), render: (o) => niceDate(o.date), className: () => "nowrap" },
            { key: "number", label: t("Order no."), render: (o) => <Link to={`/order/${encodeURIComponent(o.guid)}`} onClick={(e) => e.stopPropagation()}>{o.number}</Link> },
            { key: "items", label: t("Items"), align: "right" },
            { key: "total", label: t("Amount ₹"), align: "right", render: (o) => inr(o.total) },
            { key: "next_due", label: t("Next due"), render: (o) => niceDate(o.next_due) || "—", className: (o) => `nowrap ${o.overdue ? "late" : ""}` },
            { key: "status", label: t("Status"), render: (o) => <Badge tone={STATUS_TONE[o.status]}>{t(o.status_label)}</Badge> },
          ]}
          mobileCard={(o) => (
            <div className="order-card">
              <span><Link to={`/order/${encodeURIComponent(o.guid)}`}>{o.number}</Link></span>
              <span><Badge tone={STATUS_TONE[o.status]}>{t(o.status_label)}</Badge></span>
              <span className="oc-meta">{niceDate(o.date)} · {t(o.items === 1 ? "{n} item" : "{n} items", { n: o.items })}
                {o.next_due && <> · {t("due")} <span className={o.overdue ? "late" : ""}>{niceDate(o.next_due)}</span></>}</span>
              <span className="oc-amount">₹{inr(o.total)}</span>
            </div>
          )}
          empty={<EmptyState title={t("No orders here")}>{t(status === "open" ? "Nothing is waiting to be sent." : "Try another search.")}</EmptyState>} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} perPage={data.per_page}
                             disabled={loading} onPage={(n) => update({ page: String(n) }, true)} />}
      </Card>
    </>
  );
}
