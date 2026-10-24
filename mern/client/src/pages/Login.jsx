import { useState } from "react";
import { api } from "../api.js";

export default function Login({ onSignedIn }) {
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const d = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      onSignedIn(d.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1>SNJ Orders</h1>
      <p className="muted">Sales and purchase orders from Tally</p>
      {error && <p className="error">{error}</p>}
      <label>Username <input name="username" autoComplete="username" required autoFocus /></label>
      <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
      <button>Sign in</button>
    </form>
  );
}
