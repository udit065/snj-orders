import { NavLink } from "react-router-dom";
import { niceTime } from "../format.js";

const NAV = [
  { to: "/orders/sales", label: "Sales orders" },
  { to: "/orders/purchase", label: "Purchase orders" },
  { to: "/new-order", label: "New order" },
  { to: "/entries", label: "Entries" },
];

export default function AppShell({ user, syncedAt, onSignOut, children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand"><span className="brand-mark">SNJ</span><span>Orders</span></NavLink>
          <nav className="nav">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "on" : "")}>{n.label}</NavLink>)}
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
