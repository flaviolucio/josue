export interface Settings {
  engine: 'browser' | 'server'
  serverUrl: string
  model: string
  language: 'pt' | 'auto' | 'en' | 'es'
}

export const MODELS = [
  { id: 'onnx-community/whisper-small_timestamped', label: 'Preciso (Whisper small, ~600 MB)' },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Máximo (Whisper large-v3 turbo, ~1,1 GB, lento sem placa de vídeo)' },
  { id: 'onnx-community/whisper-base_timestamped', label: 'Rápido (Whisper base, ~200 MB, menos preciso)' },
]

const KEY = 'cifra-ai:settings-v2'
const DEFAULTS: Settings = { engine: 'browser', serverUrl: '', model: MODELS[0].id, language: 'pt' }

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULTS }
}
export function saveSettings(s: Settings) { localStorage.setItem(KEY, JSON.stringify(s)) }

export const LANG_CODES: Record<Settings['language'], string | null> = { pt: 'portuguese', auto: null, en: 'english', es: 'spanish' }
