import { useTranslation } from 'react-i18next'
import { ChartIcon, CommandIcon, GlobeIcon, UsbIcon, ZapIcon } from './icons'

/** One-time welcome shown on a fresh install — a quick orientation to the
 * app's four pillars plus the two shortcuts worth knowing on day one
 * (Ctrl+K command palette, `?` shortcut sheet). Gated by settingsStore's
 * `onboardingDone`, so it never reappears once dismissed. */
export function OnboardingScreen({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()

  const features: [React.ReactNode, string, string][] = [
    [<UsbIcon key="i" />, t('onboarding.monitorTitle'), t('onboarding.monitorDesc')],
    [<ZapIcon key="i" />, t('onboarding.flashTitle'), t('onboarding.flashDesc')],
    [<ChartIcon key="i" />, t('onboarding.plotTitle'), t('onboarding.plotDesc')],
    [<GlobeIcon key="i" />, t('onboarding.networkTitle'), t('onboarding.networkDesc')],
  ]

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-screen">
        <h1 className="onboarding-heading">{t('onboarding.welcome')}</h1>
        <p className="onboarding-subtitle">{t('onboarding.subtitle')}</p>

        <div className="onboarding-features">
          {features.map(([icon, title, desc]) => (
            <div key={title} className="onboarding-feature">
              <span className="onboarding-feature-icon">{icon}</span>
              <div>
                <div className="onboarding-feature-title">{title}</div>
                <div className="onboarding-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="onboarding-tips">
          <span>
            <CommandIcon /> <kbd>Ctrl+K</kbd> {t('onboarding.tipPalette')}
          </span>
          <span>
            <kbd>?</kbd> {t('onboarding.tipShortcuts')}
          </span>
        </div>

        <button type="button" className="connect-button onboarding-cta" onClick={onDismiss}>
          {t('onboarding.getStarted')}
        </button>
      </div>
    </div>
  )
}
