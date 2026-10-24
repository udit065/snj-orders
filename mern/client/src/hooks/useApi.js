import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useSession } from "../session.jsx";

// Loads `path` and reloads when it changes. While a new page loads, the old data stays
// on screen (dimmed by the caller via `loading`), so lists don't jump or flash.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const { setSyncedAt } = useSession();
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (id !== latest.current) return;  // a newer request has started
      if (data.synced_at !== undefined) setSyncedAt(data.synced_at);
      setState({ data, error: null, loading: false });
    } catch (e) {
      if (id === latest.current) setState((s) => ({ ...s, error: e.message, loading: false }));
    }
  }, [path, setSyncedAt]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
