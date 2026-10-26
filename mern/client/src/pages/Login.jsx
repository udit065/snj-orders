import { useState } from "react";
import { api } from "../api.js";
import { Alert, Button, Field } from "../components/ui.jsx";

export default function Login({ onSignedIn }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      const d = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      onSignedIn(d.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="card card-pad login" onSubmit={submit}>
        <div className="brand brand-lg"><span className="brand-mark">SNJ</span><span>Orders</span></div>
        <p className="muted">SNJ staff, and SNJ distributors with their mobile number</p>
        <Alert>{error}</Alert>
        <Field label="Username or mobile number"><input name="username" autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button type="submit" loading={busy}>Sign in</Button>
      </form>
    </div>
  );
}
