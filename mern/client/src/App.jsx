import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import { SessionContext } from "./session.jsx";
import AppShell from "./components/AppShell.jsx";
import { EmptyState, Spinner } from "./components/ui.jsx";
import Login from "./pages/Login.jsx";
import OrderList from "./pages/OrderList.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import NewOrder from "./pages/NewOrder.jsx";
import Entries from "./pages/Entries.jsx";

export default function App() {
  const [user, setUser] = useState(undefined);  // undefined: still checking the session
  const [syncedAt, setSyncedAt] = useState(null);

  useEffect(() => {
    api("/api/me").then((d) => { setUser(d.user); setSyncedAt(d.synced_at); }).catch(() => setUser(null));
    const signedOut = () => setUser(null);
    window.addEventListener("snj:signed-out", signedOut);
    return () => window.removeEventListener("snj:signed-out", signedOut);
  }, []);
  const session = useMemo(() => ({ user, setSyncedAt }), [user]);

  if (user === undefined) return <div className="center-screen"><Spinner label="Starting" /></div>;
  if (!user) return <Login onSignedIn={(u) => setUser(u)} />;

  const signOut = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  return (
    <SessionContext.Provider value={session}>
      <AppShell user={user} syncedAt={syncedAt} onSignOut={signOut}>
        <Routes>
          <Route path="/" element={<Navigate to="/orders/sales" replace />} />
          <Route path="/orders/:kind" element={<OrderList />} />
          <Route path="/order/:guid" element={<OrderDetail />} />
          <Route path="/new-order" element={<NewOrder />} />
          <Route path="/entries" element={<Entries />} />
          <Route path="*" element={<EmptyState title="Page not found"><Link to="/">Back to orders</Link></EmptyState>} />
        </Routes>
      </AppShell>
    </SessionContext.Provider>
  );
}
