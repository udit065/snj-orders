import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import { SessionContext } from "./session.jsx";
import { LangContext, saveLang, savedLang } from "./i18n.jsx";
import AppShell from "./components/AppShell.jsx";
import { EmptyState, Spinner } from "./components/ui.jsx";
import Login from "./pages/Login.jsx";
import OrderList from "./pages/OrderList.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import NewOrder from "./pages/NewOrder.jsx";
import Entries from "./pages/Entries.jsx";
import PhotoOrders from "./pages/PhotoOrders.jsx";
import Distributors from "./pages/Distributors.jsx";
import Catalogue from "./pages/Catalogue.jsx";
import Home from "./pages/portal/Home.jsx";
import MyOrders from "./pages/portal/MyOrders.jsx";
import SendOrder from "./pages/portal/SendOrder.jsx";
import OrderAgain from "./pages/portal/OrderAgain.jsx";
import Payments from "./pages/portal/Payments.jsx";
import Claims from "./pages/portal/Claims.jsx";
import Notices from "./pages/Notices.jsx";
import News from "./pages/News.jsx";
import Account from "./pages/Account.jsx";
import Accounts from "./pages/Accounts.jsx";
import Bill from "./pages/Bill.jsx";

const notFound = <Route path="*" element={<EmptyState title="Page not found"><Link to="/">Back to the start</Link></EmptyState>} />;

export default function App() {
  const [user, setUser] = useState(undefined);  // undefined: still checking the session
  const [syncedAt, setSyncedAt] = useState(null);
  const [lang, setLangState] = useState(savedLang);

  const loadMe = () => api("/api/me").then((d) => { setUser(d.user); setSyncedAt(d.synced_at); }).catch(() => setUser(null));
  useEffect(() => {
    loadMe();
    const signedOut = () => setUser(null);
    window.addEventListener("snj:signed-out", signedOut);
    return () => window.removeEventListener("snj:signed-out", signedOut);
  }, []);
  const session = useMemo(() => ({ user, setSyncedAt }), [user]);
  // Hindi is offered to distributors; staff screens stay English.
  const langValue = useMemo(() => ({
    lang: user?.role === "distributor" ? lang : "en",
    setLang: (l) => { saveLang(l); setLangState(l); },
  }), [user, lang]);

  if (user === undefined) return <div className="center-screen"><Spinner label="Starting" /></div>;
  if (!user) return <Login onSignedIn={loadMe} />;  // /api/me also brings the last sync time

  const signOut = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  return (
    <SessionContext.Provider value={session}>
      <LangContext.Provider value={langValue}>
      <AppShell user={user} syncedAt={syncedAt} onSignOut={signOut}>
        {user.role === "distributor" ? (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/my/orders" element={<MyOrders />} />
            <Route path="/order/:guid" element={<OrderDetail />} />
            <Route path="/send-order" element={<SendOrder />} />
            <Route path="/order-again/:guid" element={<OrderAgain />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/news" element={<News />} />
            <Route path="/catalogue" element={<Catalogue />} />
            <Route path="/account" element={<Account />} />
            <Route path="/bill/:id" element={<Bill />} />
            {notFound}
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/orders/sales" replace />} />
            <Route path="/orders/:kind" element={<OrderList />} />
            <Route path="/order/:guid" element={<OrderDetail />} />
            <Route path="/new-order" element={<NewOrder />} />
            <Route path="/entries" element={<Entries />} />
            <Route path="/photo-orders" element={<PhotoOrders />} />
            <Route path="/payments" element={<Notices />} />
            <Route path="/claims" element={<Notices />} />
            <Route path="/news" element={<News />} />
            <Route path="/catalogue" element={<Catalogue />} />
            <Route path="/distributors" element={<Distributors />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/account" element={<Account />} />
            <Route path="/bill/:id" element={<Bill />} />
            {notFound}
          </Routes>
        )}
      </AppShell>
      </LangContext.Provider>
    </SessionContext.Provider>
  );
}
