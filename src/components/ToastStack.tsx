import { useTranslation } from 'react-i18next'
import { useToastStore } from '../state/toastStore'
import { XIcon } from './icons'

/** Fixed-position stack, mounted once at the app root so a toast fired from
 * a background task (batch flash, auto-flash on plug, provisioning, OTA)
 * shows up no matter which panel or tab is currently focused. */
export function ToastStack() {
  const { t } = useTranslation()
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="icon-button toast-dismiss"
            aria-label={t('toast.dismiss')}
            onClick={() => removeToast(toast.id)}
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  )
}
