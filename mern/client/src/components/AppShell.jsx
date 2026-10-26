import { NavLink } from "react-router-dom";
import { niceTime } from "../format.js";

const STAFF_NAV = [
  { to: "/orders/sales", label: "Sales" },
  { to: "/orders/purchase", label: "Purchases" },
  { to: "/new-order", label: "New order" },
  { to: "/entries", label: "Entries" },
  { to: "/photo-orders", label: "Requests" },
  { to: "/payments", label: "Payments" },
  { to: "/claims", label: "Claims" },
  { to: "/catalogue", label: "Catalogue" },
  { to: "/distributors", label: "Distributors" },
];
const DISTRIBUTOR_NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/my/orders", label: "Orders" },
  { to: "/send-order", label: "Send order" },
  { to: "/payments", label: "Payments" },
  { to: "/claims", label: "Damage claims" },
  { to: "/catalogue", label: "Catalogue" },
];

export default function AppShell({ user, syncedAt, onSignOut, children }) {
  const distributor = user.role === "distributor";
  const nav = distributor ? DISTRIBUTOR_NAV : STAFF_NAV;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand"><span className="brand-mark">SNJ</span><span>{distributor ? "Distributor" : "Orders"}</span></NavLink>
          <nav className="nav">
            {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>{n.label}</NavLink>)}
          </nav>
          <div className="user">
            <span className="avatar" aria-hidden="true">{(user.name || "?")[0].toUpperCase()}</span>
            <span className="user-name">{user.name}</span>
            <button className="link-btn" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <div className="syncbar">
        <span className="dot" aria-hidden="true" /> Copied from Tally {niceTime(syncedAt)}
        <span className="muted"> · updates every 10 minutes</span>
      </div>
      <main className="content">{children}</main>
    </div>
  );
}
