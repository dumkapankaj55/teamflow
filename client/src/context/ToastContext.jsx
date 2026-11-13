import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
let nextToastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((items) => items.filter((item) => item.id !== id)), []);
  const toast = useCallback((message, tone = 'success') => {
    const id = ++nextToastId;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 4200);
    return id;
  }, [dismiss]);
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return <ToastContext.Provider value={value}>{children}<div className="toast-viewport" aria-live="polite" aria-relevant="additions"><ul>{toasts.map((item) => { const Icon = item.tone === 'error' ? CircleAlert : item.tone === 'info' ? Info : CheckCircle2; return <li className={`toast toast-${item.tone}`} key={item.id}><Icon size={17} /><span>{item.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={15} /></button></li>; })}</ul></div></ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value.toast;
}
