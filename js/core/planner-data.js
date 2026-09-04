/**
 * Shared data layer for the Weekly Study Planner feature.
 * Kept separate from the UI (study-planner.js) so lightweight consumers —
 * like the Pomodoro timer's "which subject was this for?" picker — can pull
 * in just the data helpers without loading the whole planner page module.
 */
import { plannerSubjectRepository, plannerWeekRepository, studySessionRepository } from './repositories.js';

export const PLANNER_DAYS = [
  { key: 'sat', label: 'شنبه' },
  { key: 'sun', label: 'یکشنبه' },
  { key: 'mon', label: 'دوشنبه' },
  { key: 'tue', label: 'سه‌شنبه' },
  { key: 'wed', label: 'چهارشنبه' },
  { key: 'thu', label: 'پنجشنبه' },
  { key: 'fri', label: 'جمعه' },
];

const DEFAULT_SUBJECT_TITLES = ['ادبیات', 'عربی', 'دین و زندگی', 'زبان انگلیسی'];

// Fixed, well-known ids for the three footer rows (فوق‌برنامه / تلویزیون و فضای
// مجازی / خواب) — these live in the same per-week "rows" map as ordinary
// subjects, just under a stable id instead of a user-created subject id.
export const FOOTER_ROWS = [
  { id: 'footer_extracurricular', title: 'فعالیت‌های فوق‌برنامه' },
  { id: 'footer_media', title: 'تلویزیون و فضای مجازی' },
  { id: 'footer_sleep', title: 'ساعات خواب' },
];

export function isFooterRowId(id) {
  return FOOTER_ROWS.some((f) => f.id === id);
}

/** Aligns any date to the Saturday that starts its week — returns 'YYYY-MM-DD'. */
export function weekStartOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const rowIndex = (d.getDay() + 1) % 7; // Sat=6 -> 0, Sun=0 -> 1, ... Fri=5 -> 6
  d.setDate(d.getDate() - rowIndex);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addWeeks(weekStartStr, n) {
  const d = new Date(weekStartStr + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return weekStartOf(d);
}

/** Human label for a week range, e.g. "۱۴ تا ۲۰ شهریور". */
export function formatWeekRangeLabel(weekStartStr) {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' });
  return `${fmt.format(start)} تا ${fmt.format(end)}`;
}

export function emptyRow() {
  return { days: { sat: '', sun: '', mon: '', tue: '', wed: '', thu: '', fri: '' }, prediction: '', teacherClass: '', taraz: '' };
}

/** Seeds a handful of common general-track subjects the very first time (empty library) so the table isn't blank. */
export async function ensureDefaultSubjects() {
  const existing = await plannerSubjectRepository.getAll();
  if (existing.length > 0) return existing.sort((a, b) => a.order - b.order);
  const created = [];
  for (let i = 0; i < DEFAULT_SUBJECT_TITLES.length; i++) {
    const subj = {
      id: `subj_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      title: DEFAULT_SUBJECT_TITLES[i],
      categoryId: null,
      order: i,
      createdAt: new Date().toISOString(),
    };
    await plannerSubjectRepository.create(subj);
    created.push(subj);
  }
  return created;
}

export async function getSubjectsSorted() {
  const subjects = await ensureDefaultSubjects();
  return subjects.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getWeekRecord(weekStart) {
  const rec = await plannerWeekRepository.getById(weekStart);
  if (rec) return rec;
  return { weekStart, rows: {}, updatedAt: null };
}

export async function saveWeekRecord(record) {
  record.updatedAt = new Date().toISOString();
  const existing = await plannerWeekRepository.getById(record.weekStart);
  if (existing) {
    await plannerWeekRepository.update(record.weekStart, record);
  } else {
    await plannerWeekRepository.create(record);
  }
  return record;
}

/** Adds `minutes` of focus time onto today's day-cell for a subject, in the week containing `when`. Used by the Pomodoro hand-off. */
export async function addMinutesToSubjectToday(subjectId, minutes, when = new Date()) {
  if (!subjectId || !(minutes > 0)) return;
  const weekStart = weekStartOf(when);
  const record = await getWeekRecord(weekStart);
  if (!record.rows) record.rows = {};
  const row = record.rows[subjectId] ? { ...record.rows[subjectId] } : emptyRow();
  row.days = { ...row.days };

  const dayIdx = (when.getDay() + 1) % 7; // 0=Sat..6=Fri, matches PLANNER_DAYS order
  const dayKey = PLANNER_DAYS[dayIdx].key;

  const existingVal = parseFloat(String(row.days[dayKey] || '').replace(/[^\d.\-]/g, ''));
  const existingHours = Number.isFinite(existingVal) ? existingVal : 0;
  const addedHours = Math.round((minutes / 60) * 100) / 100;
  const newHours = Math.round((existingHours + addedHours) * 100) / 100;

  // Preserve any non-numeric note the user had typed there by appending, so we
  // never silently discard something they wrote (e.g. "کلاس فوق" -> keep it).
  const prevRaw = String(row.days[dayKey] || '').trim();
  const prevWasPureNumber = prevRaw !== '' && Number.isFinite(parseFloat(prevRaw)) && String(parseFloat(prevRaw)) === prevRaw.replace(/^0+(?=\d)/, '');
  row.days[dayKey] = prevRaw === '' || prevWasPureNumber ? String(newHours) : `${prevRaw} + ${addedHours}`;

  record.rows[subjectId] = row;
  await saveWeekRecord(record);
  return { weekStart, dayKey, addedHours };
}

export function sumRowHours(row) {
  if (!row || !row.days) return 0;
  let total = 0;
  for (const key of Object.keys(row.days)) {
    const n = parseFloat(String(row.days[key] ?? '').replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n)) total += n;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Suggests a weekly "پیش‌بینی" hour estimate for a subject linked to an app
 * category, based on its actual average weekly study time over the last few
 * weeks (pulled from study_sessions — the same data behind the Stats tab).
 * Returns null when there isn't enough history to say anything useful; the
 * caller should treat this purely as a placeholder hint, never a forced value.
 */
export async function suggestWeeklyHours(categoryId, { weeksBack = 4 } = {}) {
  if (!categoryId) return null;
  let sessions;
  try {
    sessions = await studySessionRepository.getByIndex('categoryId', categoryId);
  } catch (e) {
    return null;
  }
  if (!sessions || sessions.length === 0) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);

  const byWeek = new Map();
  for (const s of sessions) {
    if (!s.startTime || !s.endTime) continue;
    const start = new Date(s.startTime);
    if (isNaN(start.getTime()) || start < cutoff) continue;
    const durationMin = (new Date(s.endTime).getTime() - start.getTime()) / 60000;
    if (!Number.isFinite(durationMin) || durationMin <= 0) continue;
    const wk = weekStartOf(start);
    byWeek.set(wk, (byWeek.get(wk) || 0) + durationMin);
  }
  if (byWeek.size === 0) return null;

  const totalMin = Array.from(byWeek.values()).reduce((a, b) => a + b, 0);
  const avgHoursPerWeek = totalMin / byWeek.size / 60;
  if (!Number.isFinite(avgHoursPerWeek) || avgHoursPerWeek <= 0) return null;
  return Math.round(avgHoursPerWeek * 10) / 10;
}
