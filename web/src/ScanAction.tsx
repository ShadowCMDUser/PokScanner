import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

export type ScanHandle = {
  capture: () => void;
  scanning: boolean;
  busy: boolean;
};

type ScanAction = {
  handle: ScanHandle | null;
  register: (next: ScanHandle | null) => void;
};

type Listener = () => void;

type ScanStore = {
  getSnapshot: () => ScanHandle | null;
  subscribe: (listener: Listener) => () => void;
  register: (next: ScanHandle | null) => void;
};

function sameHandle(left: ScanHandle | null, right: ScanHandle | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.capture === right.capture && left.scanning === right.scanning && left.busy === right.busy;
}

function createScanStore(): ScanStore {
  let handle: ScanHandle | null = null;
  const listeners = new Set<Listener>();

  return {
    getSnapshot: () => handle,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    register: (next) => {
      if (sameHandle(handle, next)) return;
      handle = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const ScanActionContext = createContext<ScanStore | null>(null);

export function ScanActionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createScanStore);
  return <ScanActionContext.Provider value={store}>{children}</ScanActionContext.Provider>;
}

export function useScanAction(): ScanAction {
  const store = useContext(ScanActionContext);
  if (!store) throw new Error("ScanActionProvider ontbreekt");
  const handle = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { handle, register: store.register };
}
