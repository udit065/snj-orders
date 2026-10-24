// Indian digit grouping: 482560.5 -> 4,82,560.50
export function inr(value) {
  const neg = value < 0;
  const [whole, frac] = Math.abs(value || 0).toFixed(2).split(".");
  let head = whole.slice(0, -3);
  const groups = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  const out = groups.length ? [...groups, whole.slice(-3)].join(",") : whole;
  return (neg ? "-" : "") + out + "." + frac;
}

export const qty = (v) => String(Math.round((v || 0) * 1e4) / 1e4);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-12" -> "12 Oct 2026"
export function niceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : s || "";
}

// "2026-10-17T10:42:00+05:30" -> "17 Oct, 10:42 AM" in India time
export function niceTime(s) {
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return "never";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
}
