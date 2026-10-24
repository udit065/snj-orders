import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, SignedOut } from "./api.js";
import { niceTime } from "./format.js";
import Login from "./pages/Login.jsx";
import OrderList from "./pages/OrderList.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";

export default function App() {
  const [user, setUser] = useState(undefined);  // undefined: still checking the session
  const [syncedAt, setSyncedAt] = useState(null);
  const [kind, setKind] = useState("sales");
  const location = useLocation();

  useEffect(() => {
    api("/api/me").then((d) => { setUser(d.user); setSyncedAt(d.synced_at); }).catch(() => setUser(null));
  }, []);

  // Pages fetch through this, so an ended session goes back to the login page.
  const load = useCallback(async (path) => {
    try {
      const d = await api(path);
      setSyncedAt(d.synced_at);
      return d;
    } catch (e) {
      if (e instanceof SignedOut) setUser(null);
      throw e;
    }
  }, []);

  if (user === undefined) return null;
  if (!user) return <main><Login onSignedIn={(u) => setUser(u)} /></main>;

  const signOut = async () => {
    await api("/api/logout", { method: "POST" });
    setUser(null);
  };
  const tab = location.pathname.startsWith("/orders/") ? location.pathname.split("/")[2] : kind;

  return (
    <>
      <header className="top">
        <Link className="brand" to="/">SNJ Orders</Link>
        <nav>
          <Link to="/orders/sales" className={tab === "sales" ? "on" : ""}>Sales orders</Link>
          <Link to="/orders/purchase" className={tab === "purchase" ? "on" : ""}>Purchase orders</Link>
        </nav>
        <div className="who">{user.name} · <a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}>Sign out</a></div>
      </header>
      <div className="fresh">Copied from Tally: {niceTime(syncedAt)} · view only, changes are made in Tally</div>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/orders/sales" replace />} />
          <Route path="/orders/:kind" element={<OrderList load={load} />} />
          <Route path="/order/:guid" element={<OrderDetail load={load} onKind={setKind} />} />
          <Route path="*" element={<><p className="error">Page not found.</p><p><Link to="/">Back to orders</Link></p></>} />
        </Routes>
      </main>
    </>
  );
}
