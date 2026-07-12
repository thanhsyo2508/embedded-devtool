import i18n from '../i18n'
import { useSettingsStore } from '../state/settingsStore'

/** Gate for any action that writes firmware to a device — prompts for a
 * PIN when the user has turned on Settings > Flash Lock, so a shared
 * production station can't be flashed by whoever walks up to it. No-op
 * (always authorized) when the feature is off, which is the default. */
export function authorizeFlash(): boolean {
  const { flashLockEnabled, flashLockPin } = useSettingsStore.getState()
  if (!flashLockEnabled) return true
  const entered = window.prompt(i18n.t('security.enterPinPrompt'))
  if (entered === null) return false
  if (entered !== flashLockPin) {
    window.alert(i18n.t('security.wrongPin'))
    return false
  }
  return true
}
