import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { useSession } from "../session.jsx";
import { useT } from "../i18n.jsx";
import { inr, niceDate, niceTime } from "../format.js";
import DataTable from "../components/DataTable.jsx";
import { DateRange, SegmentedFilter } from "../components/Filters.jsx";
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Skeleton, Stat, TopProgress } from "../components/ui.jsx";

const TABS = ["summary", "bills", "statement", "payments", "year"];
const TAB_LABEL = { summary: "Summary", bills: "Bills", statement: "Statement", payments: "Payments received", year: "Your year" };
const BILL_TONE = { paid: "ok", part: "info", unpaid: "warn" };
const BILL_STATE = { paid: "Paid", part: "Part paid", unpaid: "Not paid" };
const rs = (n) => `₹${inr(n)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One customer's account from Tally: a distributor sees their own, staff open any from Accounts.
export default function Account() {
  const t = useT();
  const { user } = useSession();
  const staff = user.role === "staff";
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "summary";
  const party = params.get("party") || (staff ? "" : user.parties[0] || "");
  const q = `party=${encodeURIComponent(party)}`;
  const { data: s, error, loading, reload } = useApi(party ? `/api/account/summary?${q}` : null);
  useEffect(() => { document.title = `${staff ? party : t("Your account")} · SNJ`; }, [party]);  // eslint-disable-line react-hooks/exhaustive-deps
  const go = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  if (!party) return <EmptyState title="Pick a customer"><Link to="/accounts">Back to accounts</Link></EmptyState>;
  if (error && !s) return <Alert>{error}</Alert>;
  return (
    <>
      <TopProgress active={loading} />
      <PageHeader title={staff ? party : t("Your account")}
                  back={staff ? <Link className="back" to="/accounts">← Accounts</Link> : null}
                  subtitle={s ? t("From Tally, as of {time}", { time: niceTime(s.as_of) }) : ""}
                  actions={!staff && user.parties.length > 1 && (
                    <select value={party} onChange={(e) => go({ party: e.target.value })} aria-label={t("For which account")}>
                      {user.parties.map((p) => <option key={p}>{p}</option>)}
                    </select>)} />
      <div className="tabs no-print" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}
                  onClick={() => go({ tab: k === "summary" ? "" : k })}>{t(TAB_LABEL[k])}</button>
        ))}
      </div>
      {!s ? <Card><Skeleton /><p /><Skeleton /></Card>
        : !s.known && !s.bills.length ? <EmptyState title={t("Nothing from Tally yet")}>{t("Your balance and bills appear here once SNJ's computer sends them.")}</EmptyState>
          : tab === "summary" ? <Summary s={s} staff={staff} q={q} onConfirmed={reload} go={go} />
            : tab === "bills" ? <Bills q={q} />
              : tab === "statement" ? <Statement q={q} party={party} />
                : tab === "payments" ? <Receipts q={q} />
                  : <Year q={q} />}
    </>
  );
}

function Summary({ s, staff, q, onConfirmed, go }) {
  const t = useT();
  const total = s.ageing.not_due + s.ageing.d1_15 + s.ageing.d16_30 + s.ageing.d30_plus;
  const parts = [["not_due", "Not due yet", "ok"], ["d1_15", "1–15 days late", "warn"], ["d16_30", "16–30 days late", "late"],
                 ["d30_plus", "Over 30 days late", "bad"]];
  return (
    <>
      <div className="stats">
        <Stat label={t("Balance")} value={rs(Math.abs(s.balance))}>{s.balance < 0 ? t("in your favour") : t("to pay SNJ")}</Stat>
        <Stat label={t("Overdue")} value={rs(s.overdue)} tone={s.overdue ? "late" : ""}>
          {s.overdue ? t("oldest {n} days late", { n: s.oldest_overdue_days }) : t("nothing overdue")}</Stat>
        {s.credit_limit && <Stat label={t("Credit limit")} value={rs(s.credit_limit)} tone={s.over_limit ? "late" : ""}>
          {s.over_limit ? t("over the limit by {a}", { a: rs(-s.available) }) : t("{a} still available", { a: rs(s.available) })}</Stat>}
        <Stat label={t("Last payment")} value={s.last_payment ? rs(s.last_payment.amount) : "—"}>
          {s.last_payment ? niceDate(s.last_payment.date) : t("none this year")}</Stat>
      </div>
      {total > 0 && (
        <Card title={t("What you owe, by due date")}>
          <div className="ageing-bar" role="img" aria-label={parts.map(([k, l]) => `${t(l)} ${rs(s.ageing[k])}`).join(", ")}>
            {parts.filter(([k]) => s.ageing[k] > 0).map(([k, , tone]) => (
              <span key={k} className={`ageing-${tone}`} style={{ flexGrow: s.ageing[k] }} />
            ))}
          </div>
          <div className="ageing-legend">
            {parts.map(([k, l, tone]) => (
              <div key={k}><span className={`dot-sm ageing-${tone}`} /> <span className="muted small">{t(l)}</span>
                <div className="strong">{rs(s.ageing[k])}</div></div>
            ))}
          </div>
          {s.unadjusted_credit > 0 && <p className="muted small">{t("Plus {a} paid in advance, not yet set against a bill.", { a: rs(s.unadjusted_credit) })}</p>}
        </Card>
      )}
      <Card title={t("Bills to pay")} padded={false} actions={<button className="link-btn" onClick={() => go({ tab: "bills" })}>{t("All bills")}</button>}>
        <DataTable rows={s.bills.filter((b) => b.amount > 0)} rowKey={(b) => `${b.ref}|${b.date}`}
          columns={[
            { key: "ref", label: t("Bill no."), render: (b) => b.ref || "—" },
            { key: "date", label: t("Date"), render: (b) => niceDate(b.date), className: () => "nowrap" },
            { key: "due_date", label: t("Due"), render: (b) => niceDate(b.due_date), className: () => "nowrap" },
            { key: "days_late", label: t("Days late"), align: "right", render: (b) => b.days_late || "—", className: (b) => (b.days_late ? "late" : "") },
            { key: "amount", label: t("To pay ₹"), align: "right", render: (b) => inr(b.amount) },
          ]}
          empty={<EmptyState title={t("Nothing to pay")}>{t("Every bill is paid.")}</EmptyState>} />
      </Card>
      {!staff && <ConfirmBalance s={s} q={q} onDone={onConfirmed} />}
      {!staff && <p className="center no-print"><Link className="btn btn-secondary" to="/payments">{t("Tell us you've paid")}</Link></p>}
    </>
  );
}

function ConfirmBalance({ s, q, onDone }) {
  const t = useT();
  const { data, reload } = useApi(`/api/account/confirmations?${q}`);
  const [disagree, setDisagree] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const last = data?.confirmations[0];
  const send = async (agree) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/account/confirm?${q}`, { method: "POST", body: JSON.stringify({ agree, note }) });
      setDisagree(false);
      setNote("");
      await reload();
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <Card title={t("Confirm your balance")} className="no-print">
      <Alert onClose={() => setError(null)}>{error}</Alert>
      <p>{t("SNJ's books show {a} {side} as of {d}. Is that right?", { a: rs(Math.abs(s.balance)), d: niceDate(s.today),
        side: s.balance < 0 ? t("in your favour") : t("to pay SNJ") })}</p>
      {last && <p className="muted small">{last.agree ? t("You confirmed {a} on {d}.", { a: rs(last.balance), d: niceDate(last.as_of) })
        : t("On {d} you said it differs: {n}", { d: niceDate(last.as_of), n: last.note })}</p>}
      {disagree ? (
        <div className="notice-form">
          <Field label={t("What differs?")}><textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="entry-actions">
            <Button variant="secondary" loading={busy} disabled={!note.trim()} onClick={() => send(false)}>{t("Send to SNJ")}</Button>
            <Button variant="ghost" onClick={() => setDisagree(false)}>{t("Cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="entry-actions">
          <Button loading={busy} onClick={() => send(true)}>{t("Yes, it's right")}</Button>
          <Button variant="ghost" onClick={() => setDisagree(true)}>{t("No, it differs")}</Button>
        </div>
      )}
    </Card>
  );
}

function Bills({ q }) {
  const t = useT();
  const [show, setShow] = useState("open");
  const { data, error, loading } = useApi(`/api/account/bills?${q}&status=${show}`);
  const navigate = useNavigate();
  return (
    <Card padded={false}>
      <div className="toolbar toolbar-tabs">
        <SegmentedFilter value={show} onChange={setShow} options={[{ value: "open", label: t("To pay") }, { value: "all", label: t("All bills") }]} />
      </div>
      <Alert>{error}</Alert>
      <DataTable rows={data?.bills} rowKey={(b) => b.id} loading={loading} onRowClick={(b) => navigate(`/bill/${b.id}`)}
        columns={[
          { key: "date", label: t("Date"), render: (b) => niceDate(b.date), className: () => "nowrap" },
          { key: "number", label: t("Bill no."), render: (b) => <Link to={`/bill/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.number}</Link> },
          { key: "amount", label: t("Amount ₹"), align: "right", render: (b) => inr(b.amount) },
          { key: "pending", label: t("To pay ₹"), align: "right", render: (b) => (b.pending > 0 ? inr(b.pending) : "—") },
          { key: "due_date", label: t("Due"), render: (b) => (b.pending > 0 ? niceDate(b.due_date) : "—"), className: (b) => `nowrap ${b.days_late ? "late" : ""}` },
          { key: "ship", label: t("Transport"), render: (b) => (b.ship ? [b.ship.shipped_by, b.ship.lr_no && `LR ${b.ship.lr_no}`].filter(Boolean).join(" · ") : "—") },
          { key: "state", label: t("Status"), render: (b) => <Badge tone={b.days_late ? "bad" : BILL_TONE[b.state]}>{b.days_late ? t("{n} days late", { n: b.days_late }) : t(BILL_STATE[b.state])}</Badge> },
        ]}
        mobileCard={(b) => (
          <div className="order-card">
            <span><Link to={`/bill/${b.id}`}>{b.number}</Link></span>
            <span><Badge tone={b.days_late ? "bad" : BILL_TONE[b.state]}>{b.days_late ? t("{n} days late", { n: b.days_late }) : t(BILL_STATE[b.state])}</Badge></span>
            <span className="oc-meta">{niceDate(b.date)}{b.pending > 0 && <> · {t("due")} {niceDate(b.due_date)}</>}{b.ship?.lr_no && ` · LR ${b.ship.lr_no}`}</span>
            <span className="oc-amount">{rs(b.pending > 0 ? b.pending : b.amount)}</span>
          </div>
        )}
        empty={<EmptyState title={show === "open" ? t("Nothing to pay") : t("No bills yet")} />} />
    </Card>
  );
}

function Statement({ q, party }) {
  const t = useT();
  const [range, setRange] = useState({ from: "", to: "" });
  const { data, error, loading } = useApi(`/api/account/statement?${q}&from=${range.from}&to=${range.to}`);
  return (
    <Card padded={false} className="statement">
      <div className="toolbar no-print">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <Button variant="secondary" size="sm" onClick={() => window.print()}>{t("Print / save as PDF")}</Button>
      </div>
      <Alert>{error}</Alert>
      {data && (
        <>
          <div className="print-only statement-head">
            <h2>SN Jain Industries Pvt Ltd</h2>
            <div>{t("Statement of account")}: <b>{party}</b></div>
            <div>{niceDate(data.from)} – {niceDate(data.to)}</div>
          </div>
          {data.complete === false && <Alert tone="info">{t("Some older vouchers are still being copied from Tally, so this may not add up to the balance yet.")}</Alert>}
          <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
            <table className="table statement-table">
              <thead><tr><th>{t("Date")}</th><th>{t("Particulars")}</th><th className="num">{t("Debit ₹")}</th>
                <th className="num">{t("Credit ₹")}</th><th className="num">{t("Balance ₹")}</th></tr></thead>
              <tbody>
                <tr className="strong"><td data-label={t("Date")}>{niceDate(data.from)}</td><td>{t("Opening balance")}</td><td /><td />
                  <td className="num" data-label={t("Balance ₹")}>{inr(data.opening)}</td></tr>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap" data-label={t("Date")}>{niceDate(r.date)}</td>
                    <td className="stmt-what">{t(r.kind)} {r.base === "Sales" ? <Link to={`/bill/${r.id}`}>{r.number}</Link> : r.number}
                      {r.narration && <div className="muted small">{r.narration}</div>}</td>
                    <td className="num" data-label={t("Debit ₹")}>{r.debit ? inr(r.debit) : ""}</td>
                    <td className="num" data-label={t("Credit ₹")}>{r.credit ? inr(r.credit) : ""}</td>
                    <td className="num" data-label={t("Balance ₹")}>{inr(r.balance)}</td>
                  </tr>
                ))}
                <tr className="strong"><td data-label={t("Date")}>{niceDate(data.to)}</td><td>{t("Closing balance")}</td>
                  <td className="num" data-label={t("Debit ₹")}>{inr(data.debit)}</td><td className="num" data-label={t("Credit ₹")}>{inr(data.credit)}</td><td className="num" data-label={t("Balance ₹")}>{inr(data.closing)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="muted small card-pad">{t("Positive balance: to pay SNJ. Negative: in your favour.")} {t("From Tally, as of {time}", { time: niceTime(data.as_of) })}</p>
        </>
      )}
    </Card>
  );
}

function Receipts({ q }) {
  const t = useT();
  const { data, error, loading } = useApi(`/api/account/receipts?${q}`);
  return (
    <Card padded={false}>
      <Alert>{error}</Alert>
      <DataTable rows={data?.receipts} rowKey={(r) => r.id} loading={loading}
        columns={[
          { key: "date", label: t("Date"), render: (r) => niceDate(r.date), className: () => "nowrap" },
          { key: "number", label: t("Receipt no."), render: (r) => `${t(r.kind)} ${r.number}` },
          { key: "received", label: t("Amount ₹"), align: "right", render: (r) => inr(r.received) },
          { key: "settled", label: t("Against bills"), render: (r) => r.settled.map((b) => `${b.ref} (${inr(b.amount)})`).join(", ") || t("On account") },
          { key: "narration", label: t("Note"), render: (r) => <span className="muted small">{r.narration}</span> },
        ]}
        empty={<EmptyState title={t("No payments this year")} />} />
    </Card>
  );
}

function Year({ q }) {
  const t = useT();
  const { data, error } = useApi(`/api/account/year?${q}`);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Card><Skeleton /></Card>;
  const max = Math.max(1, ...data.months.flatMap((m) => [m.billed, m.paid]));
  return (
    <>
      <div className="stats">
        <Stat label={t("Billed this year")} value={rs(data.billed)}>{t("since {d}", { d: niceDate(data.fy_start) })}</Stat>
        <Stat label={t("Paid this year")} value={rs(data.paid)} />
        {data.returns > 0 && <Stat label={t("Returns and credit notes")} value={rs(data.returns)} />}
      </div>
      <Card title={t("Month by month")}>
        <div className="year-legend"><span><i className="dot-sm bar-billed" /> {t("Billed")}</span><span><i className="dot-sm bar-paid" /> {t("Paid")}</span></div>
        <div className="year-chart">
          {data.months.map((m) => (
            <div key={m.month} className="year-row">
              <span className="muted small">{MONTHS[+m.month.slice(5) - 1]}</span>
              <div className="year-bars">
                <span className="bar-billed" style={{ width: `${(m.billed / max) * 100}%` }} title={`${t("Billed")} ${rs(m.billed)}`} />
                <span className="bar-paid" style={{ width: `${(m.paid / max) * 100}%` }} title={`${t("Paid")} ${rs(m.paid)}`} />
              </div>
              <span className="num small">{inr(m.billed)}<br /><span className="muted">{inr(m.paid)}</span></span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
