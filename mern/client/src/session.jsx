import { createContext, useContext } from "react";

// The signed-in user, and a way for pages to report when Tally was last copied.
export const SessionContext = createContext({ user: null, setSyncedAt: () => {} });
export const useSession = () => useContext(SessionContext);
