/**
 * plan-nlp.js — natural-language activity entry, rule-based and fully offline (no data leaves the phone).
 * parse("Study for one hour tomorrow at 7 PM", today) → { draft, missing, questions, understood }
 * The UI always shows a confirmation preview; anything ambiguous is returned in `missing` with a question to ask.
 */
const PlanNLP = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?';
  const dayIdx = (w) => DAYS.findIndex((d) => d.startsWith(w.toLowerCase().slice(0, 3)));
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, ninety: 90, half: 0.5 };
  const num = (w) => (/^\d+(\.\d+)?$/.test(w) ? Number(w) : NUM[w.toLowerCase()]);
  const CAT_WORDS = [
    ['study', /\b(study|studies|revise|revision|read(ing)?|exam|viva|journal|lecture|course|notes|mcq|prep(are)?|learn)\b/i],
    ['health', /\b(gym|exercise|work ?out|run(ning)?|jog|walk(ing)?|yoga|swim(ming)?|cycle|cycling|meditat\w*|doctor|dentist|physio|medicine|checkup|sleep)\b/i],
    ['family', /\b(family|kids?|son|daughter|wife|husband|mom|mum|mother|dad|father|parents?|school|birthday|anniversary)\b/i],
    ['clinical', /\b(ot|theatre|theater|case|duty|rounds|clinic|ward|icu|surgery|pre-?op|anaesthe\w*|anesthe\w*|hospital|on-?call)\b/i],
    ['personal', /\b(appointment|meeting|call|bank|shopping|grocer\w*|bill|pay|haircut|car|travel|flight|friend)\b/i],
  ];
  const CAT_DEFAULT_HOUR = { study: '19:00', health: '06:30', family: '18:00', clinical: '08:00', personal: '10:00', other: '10:00' };

  function parse(text, today, opts = {}) {
    let s = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    const understood = [], missing = [], questions = [];
    const take = (re, fn) => { const m = s.match(re); if (!m) return false; const r = fn(m); if (r !== false) { s = s.replace(m[0], ' '); return true; } return false; };
    const d = { title: '', date: '', start: '', end: '', minutes: 0, category: '', reminders: [], alarm: false, recur: { freq: 'none', interval: 1, days: [], until: '', count: 0 } };
    let wantsReminder = false, timesPerWeek = 0, partOfDay = '';

    // reminders: "remind me (30 minutes) before", "remind me", "with an alarm"
    take(/\bremind me\s+(\d+|five|ten|fifteen|thirty|sixty|an?|one|half an?)\s*(min(?:ute)?s?|hours?|hrs?)\s+(?:before|earlier|ahead)\b/i, (m) => { const n = m[1].startsWith('half') ? 30 : num(m[1].split(' ')[0]) * (/^h/i.test(m[2]) ? 60 : 1); d.reminders = [n]; wantsReminder = true; understood.push(`reminder ${n} min before`); });
    take(/\b(?:with an?|set an?|and an?)\s+alarm\b|\balarm\b/i, () => { d.alarm = true; understood.push('alarm'); });
    take(/\bremind me(?:\s+(?:about|to|of))?\b/i, () => { wantsReminder = true; });
    // duration: "for one hour", "for 90 min", "for half an hour", "2 hours", "1.5 h"
    take(/\bfor\s+(half an?|an?|one|two|three|four|five|six|\d+(?:\.\d+)?)\s*(?:and a half\s+)?(hours?|hrs?|h|minutes?|mins?|m)\b/i, (m) => { let n = m[1].startsWith('half') ? 0.5 : num(m[1]); if (/and a half/i.test(m[0])) n += 0.5; d.minutes = Math.round(/^h/i.test(m[2]) ? n * 60 : n); understood.push(`${d.minutes} min`); });
    if (!d.minutes) take(/\b(\d+(?:\.\d+)?|one|two|three|half an?)\s*(hours?|hrs?|minutes?|mins?)\b(?!\s+(?:before|earlier))/i, (m) => { const n = m[1].startsWith('half') ? 0.5 : num(m[1]); d.minutes = Math.round(/^h/i.test(m[2]) ? n * 60 : n); understood.push(`${d.minutes} min`); });
    // recurrence
    take(/\b(?:every ?day|daily|each day)\b/i, () => { d.recur.freq = 'daily'; understood.push('every day'); });
    take(/\b(?:on |every )?weekdays\b|\bmonday to friday\b|\bmon-fri\b/i, () => { d.recur.freq = 'weekdays'; understood.push('weekdays'); });
    take(/\b(one|two|three|four|five|six|\d)\s+(?:days|times)\s+(?:a|per|each)\s+week\b/i, (m) => { timesPerWeek = num(m[1]); d.recur.freq = 'weekly'; understood.push(`${timesPerWeek}× a week`); });
    take(new RegExp(`\\b(?:every|each|on)\\s+((?:${DAY_RE})(?:\\s*(?:,|and|&)\\s*(?:${DAY_RE}))*)\\b`, 'i'), (m) => {
      if (!/\b(every|each)\b/i.test(m[0]) && !/(,|and|&)/.test(m[1])) return false; // plain "on Monday" is a date, handled below
      const days = [...m[1].matchAll(new RegExp(DAY_RE, 'gi'))].map((x) => dayIdx(x[0])).filter((x) => x >= 0); d.recur.freq = 'weekly'; d.recur.days = [...new Set(days)].sort(); understood.push('weekly'); });
    take(/\b(?:every|each)\s+week\b|\bweekly\b/i, () => { if (d.recur.freq === 'none') { d.recur.freq = 'weekly'; understood.push('weekly'); } });
    take(/\b(?:every|each)\s+month\b|\bmonthly\b/i, () => { d.recur.freq = 'monthly'; understood.push('monthly'); });
    take(/\buntil\s+(\d{1,2})\s*(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/i, (m) => { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); let y = +today.slice(0, 4); let c = `${y}-${pad(mo + 1)}-${pad(+m[1])}`; if (c < today) c = `${y + 1}-${pad(mo + 1)}-${pad(+m[1])}`; d.recur.until = c; understood.push(`until ${c}`); });
    // date
    take(/\bday after tomorrow\b/i, () => { d.date = addDays(today, 2); });
    take(/\btomorrow\b|\btmrw\b|\btmr\b/i, () => { d.date = addDays(today, 1); });
    take(/\btoday\b|\btonight\b/i, (m) => { d.date = today; if (/tonight/i.test(m[0])) partOfDay = 'evening'; });
    take(/\bin\s+(\d+|one|two|three|four|five|six|seven)\s+days?\b/i, (m) => { d.date = addDays(today, num(m[1])); });
    take(/\bnext week\b/i, () => { d.date = addDays(today, 7 - ((parseISO(today).getDay() + 6) % 7)); });
    take(new RegExp(`\\b(next|this|on|coming)?\\s*(${DAY_RE})\\b`, 'i'), (m) => { const t = dayIdx(m[2]); if (t < 0) return false; const cur = parseISO(today).getDay(); let diff = (t - cur + 7) % 7; if (diff === 0 || /next/i.test(m[1] || '')) diff = diff === 0 ? 7 : diff; if (/next/i.test(m[1] || '') && diff < 7 && opts.strictNext) diff += 7; d.date = addDays(today, diff); if (d.recur.freq === 'weekly' && !d.recur.days.length && !timesPerWeek) d.recur.days = [t]; });
    take(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b|\b(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => { const day = +(m[1] || m[4]), mo = MONTHS.indexOf((m[2] || m[3]).slice(0, 3).toLowerCase()); const y = +today.slice(0, 4); let c = `${y}-${pad(mo + 1)}-${pad(day)}`; if (c < today) c = `${y + 1}-${pad(mo + 1)}-${pad(day)}`; d.date = c; });
    // time ranges "7-8 pm", "from 6 to 7:30 am", "19:00-20:30"
    const hm = (h, mi, ap) => { let H = +h; const M = +(mi || 0); if (ap) { ap = ap.toLowerCase(); if (ap.startsWith('p') && H < 12) H += 12; if (ap.startsWith('a') && H === 12) H = 0; } return H < 24 && M < 60 ? `${pad(H)}:${pad(M)}` : ''; };
    take(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i, (m) => { if (!m[3] && !m[6] && !m[2] && !m[5]) return false; const ap2 = m[6] || m[3], ap1 = m[3] || (m[6] && +m[1] <= +m[4] ? m[6] : m[6] && /p/i.test(m[6]) ? 'am' : m[6]); d.start = hm(m[1], m[2], ap1); d.end = hm(m[4], m[5], ap2); if (!d.start || !d.end) return false; understood.push(`${d.start}–${d.end}`); });
    if (!d.start) take(/\b(?:at|@|by|around)?\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/i, (m) => { d.start = hm(m[1], m[2], m[3]); return d.start ? undefined : false; });
    if (!d.start) take(/\b(?:at|@)\s*([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { d.start = hm(m[1], m[2]); });
    if (!d.start) take(/\bat\s+(\d{1,2})\b/i, (m) => { const H = +m[1]; if (H > 23) return false; d.start = hm(H <= 6 ? H + 12 : H, 0); questions.push(`Assumed ${d.start} for “at ${m[1]}” — change it if you meant otherwise.`); });
    if (!d.date) take(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/, (m) => { const day = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || day < 1 || day > 31) return false; const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4); let c = `${y}-${pad(mo)}-${pad(day)}`; if (!m[3] && c < today) c = `${y + 1}-${pad(mo)}-${pad(day)}`; d.date = c; });
    take(/\b(?:at\s+)?(noon|midday|midnight)\b/i, (m) => { d.start = /mid(night)/i.test(m[1]) ? '00:00' : '12:00'; });
    take(/\b(?:in the\s+|this\s+)?(early morning|morning|afternoon|evening|night)\b/i, (m) => { partOfDay = m[1].toLowerCase(); });
    // category
    const raw = String(text || '');
    for (const [c, re] of CAT_WORDS) if (re.test(raw)) { d.category = c; break; }
    if (!d.category) d.category = 'personal';
    // title: what's left, tidied
    let t = s.replace(/\b(at|on|for|from|by|in|the|every|each|a|an|to|about|me|please|and|with|set|remind|repeat|schedule|add|plan|book)\b/gi, (w, _x, off, all) => w).replace(/\s+/g, ' ').trim();
    t = t.replace(/^(please\s+)?(add|schedule|plan|book|repeat|set up|create)\s+/i, '').replace(/^(to|about|the|a|an|for|me)\s+/i, '').replace(/\s+(at|on|for|by|in|and|the|a|an|to|about|from|every)$/i, '').replace(/^(the|a|an)\s+/i, '').replace(/[,.;:!]+$/g, '').trim();
    t = t.replace(/\s+(at|on|for|by|in|and|to|about|from)$/i, '').trim();
    d.title = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';

    // defaults + ambiguity
    if (!d.title) { missing.push('title'); questions.push('What is the activity?'); }
    if (!d.date) { if (d.recur.freq !== 'none') d.date = today; else { d.date = today; questions.push('No date found — set for today. Change it if needed.'); } }
    if (!d.start) {
      const P = { 'early morning': '06:00', morning: '08:00', afternoon: '14:00', evening: '18:00', night: '21:00' };
      if (partOfDay) { d.start = P[partOfDay]; questions.push(`“${partOfDay}” → ${d.start}. Adjust if needed.`); }
      else { missing.push('time'); questions.push('What time should it start?'); d.start = CAT_DEFAULT_HOUR[d.category]; }
    }
    if (!d.minutes) d.minutes = d.end ? 0 : d.category === 'personal' && wantsReminder ? 30 : 60;
    if (!d.end) { const [H, M] = d.start.split(':').map(Number); const e = (H * 60 + M + d.minutes) % 1440; d.end = `${pad(Math.floor(e / 60))}:${pad(e % 60)}`; }
    if (d.recur.freq === 'weekly' && timesPerWeek && d.recur.days.length < timesPerWeek) {
      const pick = { 1: [1], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] }[timesPerWeek] || [1, 3, 5];
      d.recur.days = pick; missing.push('days'); questions.push(`Which ${timesPerWeek} days? Suggested ${pick.map((x) => DAYS[x].slice(0, 3)).join(', ')} — change if needed.`);
    }
    if (d.recur.freq === 'weekly' && !d.recur.days.length) d.recur.days = [parseISO(d.date).getDay()];
    if (d.recur.freq === 'weekly' && d.recur.days.length) { let k = 0; while (!d.recur.days.includes(parseISO(d.date).getDay()) && k++ < 7) d.date = addDays(d.date, 1); }
    if (d.recur.freq === 'weekdays') { let k = 0; while ([0, 6].includes(parseISO(d.date).getDay()) && k++ < 3) d.date = addDays(d.date, 1); }
    if (wantsReminder && !d.reminders.length) d.reminders = [15];
    if (!wantsReminder && !d.reminders.length) d.reminders = [10];
    return { draft: d, missing, questions, understood };
  }
  return { parse };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PlanNLP;
if (typeof window !== 'undefined') window.PlanNLP = PlanNLP;
