// Calls to the Express server. A 401 means the session ended: the app shows the login page.
export class SignedOut extends Error {}

export async function api(path, { signal, headers, ...options } = {}) {
  const res = await fetch(path, {
    ...options,
    signal,
    headers: headers || (options.body ? { "Content-Type": "application/json" } : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    window.dispatchEvent(new Event("snj:signed-out"));
    throw new SignedOut("Please sign in again.");
  }
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Please try again.");
  return data;
}

// Sends a file as it is (a photo or a PDF); extra details go in the address.
export function upload(path, file, contentType = file.type) {
  return api(path, { method: "POST", body: file, headers: { "Content-Type": contentType } });
}
