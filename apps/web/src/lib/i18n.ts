/**
 * Minimal English/Hindi switch for the commuter app. The English text is the key, so
 * components read naturally (`t('Plan a trip')`) and anything untranslated falls back to
 * English instead of showing a key. Placeholders: `{name}`.
 *
 * Hindi strings are a first draft: have them reviewed by native speakers from the pilot
 * area before a field pilot (see docs/ui-deficiency-register.md, UI-04).
 */
export const LANGS = ['en', 'hi'] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = 'transit.lang.v1';
const NBSP = ' ';

const HI: Record<string, string> = {
  // App shell
  'Plan a trip': 'यात्रा प्लान करें',
  'Nearby lines': 'आस-पास की लाइनें',
  'Trip planner': 'यात्रा प्लानर',
  'Change language': 'भाषा बदलें',

  // Search
  From: 'कहाँ से',
  To: 'कहाँ तक',
  'Where from?': 'कहाँ से?',
  'Where to?': 'कहाँ जाना है?',
  'Finding your location…': 'आपकी लोकेशन ढूँढ रहे हैं…',
  'Start from my current location': 'मेरी मौजूदा लोकेशन से शुरू करें',
  'Use my location': 'मेरी लोकेशन इस्तेमाल करें',
  'Locating…': 'लोकेशन ढूँढ रहे हैं…',
  'Swap start and destination': 'शुरुआत और मंज़िल आपस में बदलें',
  'Searching…': 'खोज रहे हैं…',
  'Search is unavailable right now. Check your connection.':
    'अभी खोज उपलब्ध नहीं है। अपना इंटरनेट कनेक्शन देखें।',
  'No places found. Try a landmark or market name.':
    'कोई जगह नहीं मिली। किसी मशहूर जगह या बाज़ार का नाम लिखें।',
  'Clear {label}': '{label} मिटाएँ',
  '{label} suggestions': '{label} के सुझाव',

  // Results
  '1 way to go': 'जाने का 1 तरीका',
  '{n} ways to go': 'जाने के {n} तरीके',
  'Updating…': 'अपडेट हो रहा है…',
  'Saved {time}': 'सेव किया गया: {time}',
  "We couldn't reach the route planner.": 'रूट प्लानर से संपर्क नहीं हो सका।',
  "You're offline and this trip isn't saved on your phone yet.":
    'आप ऑफ़लाइन हैं और यह यात्रा अभी आपके फ़ोन में सेव नहीं है।',
  'Try again': 'फिर से कोशिश करें',
  'Search wider': 'और दूर तक खोजें',
  'Closest line': 'सबसे पास की लाइन',
  'Fares and times are estimates; confirm the fare with the driver. Waits use a stand marshal’s report when one is recent, otherwise how often the route usually runs.':
    'किराया और समय अनुमान हैं; किराया ड्राइवर से पक्का कर लें। हाल की स्टैंड रिपोर्ट हो तो इंतज़ार उसी से बताया जाता है, वरना इस पर कि रूट आम तौर पर कितनी बार चलता है।',
  'Where are you going?': 'आप कहाँ जा रहे हैं?',
  'Search a market, metro station or landmark. Tap':
    'कोई बाज़ार, मेट्रो स्टेशन या मशहूर जगह खोजें। जहाँ आप हैं वहीं से शुरू करने के लिए',
  'to start from where you are. We’ll show shared autos, taxis and minibuses with the expected wait at each stand.':
    'दबाएँ। हम शेयर्ड ऑटो, टैक्सी और मिनीबस दिखाएँगे, हर स्टैंड पर अनुमानित इंतज़ार के साथ।',
  'Recent trips': 'हाल की यात्राएँ',
  'Saved {time} · works offline': 'सेव: {time} · ऑफ़लाइन भी चलेगा',
  'Start and destination are the same place. Pick a different destination.':
    'शुरुआत और मंज़िल एक ही जगह है। कोई दूसरी मंज़िल चुनें।',
  'None of the routes this app knows stop within a short walk of your start. Try starting from a nearby landmark or main road.':
    'इस ऐप को पता कोई भी रूट आपकी शुरुआत की जगह से पैदल दूरी पर नहीं रुकता। पास की किसी मशहूर जगह या मुख्य सड़क से शुरू करके देखें।',
  'None of the routes this app knows stop within a short walk of your destination. Try a nearby landmark or main road.':
    'इस ऐप को पता कोई भी रूट आपकी मंज़िल से पैदल दूरी पर नहीं रुकता। पास की कोई मशहूर जगह या मुख्य सड़क चुनकर देखें।',
  "The routes near these places usually aren't running at this hour. Try again during the day.":
    'इन जगहों के पास के रूट आम तौर पर इस समय नहीं चलते। दिन में फिर से देखें।',
  "We couldn't find a way between these places with the routes this app knows. Other shared autos or buses may still run here.":
    'इस ऐप को पता रूट से इन जगहों के बीच कोई रास्ता नहीं मिला। हो सकता है यहाँ दूसरे शेयर्ड ऑटो या बसें फिर भी चलती हों।',

  // Itinerary
  'Option {n}: ': 'विकल्प {n}: ',
  'est. fare': 'अनुमानित किराया',
  'Arrive ~{time} · {walk} walking': 'पहुँचेंगे ~{time} · {walk} पैदल',
  'Walk to {place}': '{place} तक पैदल चलें',
  '{distance} · about {duration}': '{distance} · लगभग {duration}',
  'from {place}': '{place} से',
  'Get off at': 'उतरें:',
  'leaves {frequency}': '{frequency} में चलती है',
  'Arrive at {place}': '{place} पहुँचें',

  // Units and times
  [`{n}${NBSP}min`]: `{n}${NBSP}मिनट`,
  [`{h}${NBSP}h {m}${NBSP}min`]: `{h}${NBSP}घंटा {m}${NBSP}मिनट`,
  [`{h}${NBSP}h`]: `{h}${NBSP}घंटा`,
  'every {n} min': 'हर {n} मिनट',
  'every {min}–{max} min': 'हर {min}–{max} मिनट',
  'just now': 'अभी-अभी',
  '{n} min ago': '{n} मिनट पहले',
  '{n} h ago': '{n} घंटे पहले',
  '{n} d ago': '{n} दिन पहले',
  'under 1 min': '1 मिनट से कम',
  'within {n} min': '{n} मिनट के अंदर',
  '{min}–{max} min': '{min}–{max} मिनट',

  // Modes and levels
  Walk: 'पैदल',
  'Shared auto': 'शेयर्ड ऑटो',
  'E-rickshaw': 'ई-रिक्शा',
  'Shared taxi': 'शेयर्ड टैक्सी',
  Minibus: 'मिनीबस',
  Bus: 'बस',
  autos: 'ऑटो',
  'e-rickshaws': 'ई-रिक्शा',
  taxis: 'टैक्सी',
  minibuses: 'मिनीबस',
  buses: 'बसें',
  vehicles: 'गाड़ियाँ',
  'Short wait': 'कम इंतज़ार',
  'Moderate wait': 'थोड़ा इंतज़ार',
  'Long wait': 'लंबा इंतज़ार',
  'No queue': 'कोई लाइन नहीं',
  'Normal queue': 'सामान्य लाइन',
  Crowded: 'भीड़',
  'Very crowded': 'बहुत भीड़',
  'Seats free': 'सीट खाली',
  'Standing only': 'सिर्फ़ खड़े होने की जगह',
  Full: 'पूरी भरी',

  // Stand badge
  'Reported at the stand:': 'स्टैंड की रिपोर्ट:',
  '~{n} min wait': '~{n} मिनट इंतज़ार',
  '{n} {vehicles} at stand': 'स्टैंड पर {n} {vehicles}',
  'reported {time}': 'रिपोर्ट: {time}',
  'last stand report {time}': 'आखिरी स्टैंड रिपोर्ट: {time}',
  'no stand report yet': 'अभी कोई स्टैंड रिपोर्ट नहीं',

  // Banners
  'You’re offline. Recent trips still work.': 'आप ऑफ़लाइन हैं। हाल की यात्राएँ फिर भी खुलेंगी।',
  'Install the app': 'ऐप इंस्टॉल करें',
  'Add to home screen': 'होम स्क्रीन पर जोड़ें',
  'Opens instantly, keeps recent trips offline.': 'तुरंत खुलता है, हाल की यात्राएँ ऑफ़लाइन रखता है।',
  Install: 'इंस्टॉल करें',
  'Dismiss install suggestion': 'इंस्टॉल का सुझाव हटाएँ',

  // Ride sharing
  'I’m on this {vehicle}': 'मैं इस {vehicle} में हूँ',
  'Share where this {vehicle} is?': 'बताएँ कि यह {vehicle} कहाँ है?',
  'People waiting for {route} will see it move on the map. Your position is placed on the route line and is not saved; no name or account is attached. It stops when you tap Stop, close the app, or after 2 hours.':
    '{route} का इंतज़ार कर रहे लोग इसे मैप पर चलते देखेंगे। आपकी लोकेशन रूट की लाइन पर दिखाई जाती है और सेव नहीं होती; कोई नाम या अकाउंट नहीं जुड़ता। यह तब रुकेगा जब आप "रोकें" दबाएँगे, ऐप बंद करेंगे, या 2 घंटे बाद।',
  'Start sharing': 'शेयर करना शुरू करें',
  'Not now': 'अभी नहीं',
  'Sharing this ride': 'यह सवारी शेयर हो रही है',
  'Sharing your ride': 'आपकी सवारी शेयर हो रही है',
  'Sharing your ride on {route}': '{route} पर आपकी सवारी शेयर हो रही है',
  'Finding your location… ': 'आपकी लोकेशन ढूँढ रहे हैं… ',
  'Others can see this vehicle on the map.': 'दूसरे लोग यह गाड़ी मैप पर देख सकते हैं।',
  "You're not on this route's path. Did you board a different route?":
    'आप इस रूट के रास्ते पर नहीं हैं। क्या आप किसी दूसरे रूट की गाड़ी में बैठे हैं?',
  'GPS signal is weak. Waiting for a better fix.': 'GPS सिग्नल कमज़ोर है। बेहतर सिग्नल का इंतज़ार है।',
  "Can't reach the server. Will keep trying.": 'सर्वर से संपर्क नहीं हो रहा। कोशिश जारी है।',
  'Keep this page open.': 'यह पेज खुला रखें।',
  Stop: 'रोकें',
  'How full is it?': 'कितनी भरी है?',
  'How full is it? (helps people waiting)': 'कितनी भरी है? (इंतज़ार कर रहे लोगों की मदद होगी)',
  'Thanks for sharing your ride.': 'सवारी शेयर करने के लिए धन्यवाद।',
  'Sharing stopped automatically after 2 hours.': '2 घंटे बाद शेयर करना अपने-आप रुक गया।',
  'Location is blocked, so your ride could not be shared. Allow it in browser settings.':
    'लोकेशन बंद है, इसलिए सवारी शेयर नहीं हो सकी। ब्राउज़र की सेटिंग में इसे चालू करें।',
  "This browser can't share location.": 'यह ब्राउज़र लोकेशन शेयर नहीं कर सकता।',
  'The server could not accept this ride.': 'सर्वर यह सवारी स्वीकार नहीं कर सका।',
  '{route} was visible to others.': '{route} दूसरों को दिख रही थी।',
  Dismiss: 'हटाएँ',
  'Next {route} {eta} away': 'अगली {route}: {eta} में',
  'shared by a rider on board': 'अंदर बैठे यात्री ने शेयर की',

  // Route suggestions
  'Know a shared auto or bus between these places? Tell us':
    'इन जगहों के बीच कोई शेयर्ड ऑटो या बस पता है? हमें बताएँ',
  'Suggest a route': 'रूट सुझाएँ',
  'Suggest a route from {from} to {to}': '{from} से {to} तक का रूट सुझाएँ',
  Vehicle: 'वाहन',
  'Not sure': 'पक्का नहीं पता',
  'Name or number on the vehicle': 'वाहन पर लिखा नाम या नंबर',
  '(optional)': '(ज़रूरी नहीं)',
  'Usual fare in ₹': 'आम किराया (₹)',
  'Where to board, how often it runs': 'कहाँ से बैठें, कितनी बार चलती है',
  'We save the two places (to about 100 m) and what you write here, with no name or account. Please don’t include phone numbers.':
    'हम दोनों जगहें (लगभग 100 मीटर तक) और आपका लिखा हुआ सेव करते हैं, बिना किसी नाम या अकाउंट के। कृपया फ़ोन नंबर न लिखें।',
  'Too many suggestions from this connection. Please try again in a minute.':
    'इस कनेक्शन से बहुत सारे सुझाव आए हैं। एक मिनट बाद फिर कोशिश करें।',
  'Could not send. Check your connection and try again.':
    'भेजा नहीं जा सका। अपना कनेक्शन देखकर फिर कोशिश करें।',
  'Send suggestion': 'सुझाव भेजें',
  'Sending…': 'भेज रहे हैं…',
  Cancel: 'रद्द करें',
  'Thanks! Your suggestion is saved for review. It won’t appear in results until someone checks it with drivers.':
    'धन्यवाद! आपका सुझाव जाँच के लिए सेव हो गया है। ड्राइवरों से पक्का होने तक यह नतीजों में नहीं दिखेगा।',
};

const TABLES: Record<Lang, Record<string, string>> = { en: {}, hi: HI };

function initialLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'hi') return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  const nav = globalThis.navigator?.language ?? 'en';
  return nav.toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // not persisted; still switches for this visit
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Translate English source text, filling `{placeholders}`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const template = TABLES[current][text] ?? text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** For tests: every Hindi entry keeps the placeholders of its English key. */
export function placeholderMismatches(): string[] {
  const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  return Object.entries(HI)
    .filter(([en, hi]) => names(en) !== names(hi))
    .map(([en]) => en);
}
