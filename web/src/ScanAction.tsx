import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type ScanHandle = {
  capture: () => void;
  scanning: boolean;
  busy: boolean;
};

type ScanAction = {
  handle: ScanHandle | null;
  register: (next: ScanHandle | null) => void;
};

const ScanActionContext = createContext<ScanAction | null>(null);

export function ScanActionProvider({ children }: { children: ReactNode }) {
  const [handle, register] = useState<ScanHandle | null>(null);
  const value = useMemo(() => ({ handle, register }), [handle]);
  return <ScanActionContext.Provider value={value}>{children}</ScanActionContext.Provider>;
}

export function useScanAction() {
  const context = useContext(ScanActionContext);
  if (!context) throw new Error("ScanActionProvider ontbreekt");
  return context;
}
