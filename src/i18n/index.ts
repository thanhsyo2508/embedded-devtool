import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import vi from './locales/vi.json'

export type SupportedLanguage = 'en' | 'vi'

// Reads the persisted language directly from localStorage (rather than
// importing settingsStore, which itself imports this module to call
// i18n.changeLanguage — importing the store back here would be circular).
// Falls back to English if nothing was ever saved or the value is stale/bad.
function initialLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem('edt-settings')
    if (!raw) return 'en'
    const parsed = JSON.parse(raw) as { state?: { language?: string } }
    return parsed.state?.language === 'vi' ? 'vi' : 'en'
  } catch {
    return 'en'
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes JSX output
})

export default i18n
