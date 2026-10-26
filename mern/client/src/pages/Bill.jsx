import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.js";
import { useSession } from "../session.jsx";
import { useT } from "../i18n.jsx";
import { inr, niceDate, qty } from "../format.js";
import { Alert, Button, Card, PageHeader, Skeleton } from "../components/ui.jsx";

// One sales bill from Tally, laid out to print or save as PDF.
export default function Bill() {
  const t = useT();
  const { id } = useParams();
  const { user } = useSession();
  const { data: b, error } = useApi(`/api/account/entry/${id}`);
  useEffect(() => { if (b) document.title = `${t("Bill")} ${b.number} · SNJ`; }, [b]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Alert>{error}</Alert>;
  if (!b) return <Card><Skeleton width="40%" height={24} /><p /><Skeleton /></Card>;
  const back = user.role === "staff" ? `/account?party=${encodeURIComponent(b.party)}&tab=bills` : "/account?tab=bills";
  const goods = b.lines.reduce((s, l) => s + l.amount, 0);
  return (
    <>
      <PageHeader title={`${t("Bill")} ${b.number}`} subtitle={`${niceDate(b.date)} · ${b.party}`}
                  back={<Link className="back no-print" to={back}>← {t("Bills")}</Link>}
                  actions={<Button variant="secondary" className="no-print" onClick={() => window.print()}>{t("Print / save as PDF")}</Button>} />
      <Card className="bill">
        <div className="bill-head">
          <div><div className="bill-from">SN Jain Industries Pvt Ltd</div><div className="muted small">GSTIN 09ABHCS0526J1Z7</div></div>
          <div className="num"><div className="strong">{b.voucher_type} {b.number}</div><div>{niceDate(b.date)}</div></div>
        </div>
        <div className="bill-parties">
          <div><div className="muted small">{t("Billed to")}</div><div className="strong">{b.party}</div>{b.gstin && <div className="small">GSTIN {b.gstin}</div>}</div>
          {b.reference && <div><div className="muted small">{t("Order")}</div><div>{b.reference}</div></div>}
          {b.ship && (
            <div><div className="muted small">{t("Transport")}</div>
              <div>{b.ship.shipped_by}{b.ship.destination && ` → ${b.ship.destination}`}</div>
              {b.ship.lr_no && <div className="small">LR {b.ship.lr_no}{b.ship.lr_date && `, ${niceDate(b.ship.lr_date)}`}</div>}
              {b.ship.vehicle && <div className="small">{t("Vehicle")} {b.ship.vehicle}</div>}</div>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("Item")}</th><th>{t("Size")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Rate ₹")}</th><th className="num">{t("Amount ₹")}</th></tr></thead>
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={i}><td data-label={t("Item")}>{l.item}</td><td data-label={t("Size")}>{l.size || "—"}</td>
                  <td data-label={t("Qty")} className="num">{qty(l.qty)} {l.unit}</td><td data-label={t("Rate ₹")} className="num">{inr(l.rate)}</td>
                  <td data-label={t("Amount ₹")} className="num">{inr(l.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bill-totals">
          {b.lines.length > 0 && <div><span className="muted">{t("Goods")}</span><span>₹{inr(goods)}</span></div>}
          {b.lines.length > 0 && Math.abs(b.amount - goods) >= 0.5 && <div><span className="muted">{t("Tax, freight and rounding")}</span><span>₹{inr(b.amount - goods)}</span></div>}
          <div className="strong"><span>{t("Bill total")}</span><span>₹{inr(b.amount)}</span></div>
        </div>
        {b.narration && <p className="muted small">{b.narration}</p>}
        <p className="muted small">{t("A copy of the bill as recorded in SNJ's Tally. The signed tax invoice is the original.")}</p>
      </Card>
    </>
  );
}
