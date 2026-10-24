// Calls to the Express server. A 401 means the session ended: the app shows the login page.
export class SignedOut extends Error {}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") throw new SignedOut();
  if (!res.ok) throw new Error(data.detail || "Something went wrong.");
  return data;
}
