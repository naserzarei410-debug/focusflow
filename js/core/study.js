

import { flashcardRepository, reviewHistoryRepository, studySessionRepository, categoryRepository } from './repositories.js';
import { State, schedule, Rating } from './fsrs.js';
import { db } from './db.js';

/** Local calendar YYYY-MM-DD (avoids UTC day-shift for Iran UTC+3:30). */
export function localDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return localDateStr(new Date());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** UTC day index from YYYY-MM-DD (stable calendar distance). */
function dayIndex(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

/** YYYY-MM-DD from UTC day index. */
function dateFromDayIndex(idx) {
  const dt = new Date(idx * 86400000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * How many brand-new (never-studied) cards are still allowed to be
 * introduced today, based on the 'new_cards_per_day' setting (default 20).
 * A card counts as "introduced today" when its very first review
 * (reviewCount === 1) happened today — this is a lightweight proxy that
 * doesn't require a separate history table.
 *
 * This is deliberately global (not per-category): the daily cap is meant to
 * limit the total new-card workload across the whole app, not per category.
 */
export async function getRemainingNewCardQuota() {
  let limit = 20;
  try {
    const raw = await db.getSetting('new_cards_per_day', '20');
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) limit = parsed;
  } catch (e) { /* keep default */ }

  const todayStr = localDateStr();
  let introducedToday = 0;
  try {
    const allCards = await flashcardRepository.getAll();
    introducedToday = allCards.filter((c) =>
      !c.deleted &&
      c.reviewCount === 1 &&
      c.lastReviewed &&
      localDateStr(c.lastReviewed) === todayStr
    ).length;
  } catch (e) { /* if this fails, fall back to the full limit */ }

  return Math.max(0, limit - introducedToday);
}

/**
 * Retrieves the study queues for a specific category or globally.
 * Returns { due: Card[], learning: Card[], new: Card[] }
 * The "new" queue is capped to today's remaining new-card quota so a large
 * library doesn't dump hundreds of unstudied cards into a single session.
 */
export async function getStudyQueues(categoryId = null) {
  let cards = [];
  if (categoryId) {
    cards = await flashcardRepository.getByIndex('categoryId', categoryId);
  } else {
    cards = await flashcardRepository.getAll();
  }

  const activeCards = cards.filter(c => !c.deleted);
  const now = new Date();

  const due = [];
  const learning = [];
  const newCards = [];

  activeCards.forEach(card => {
    const fsrsState = card.fsrsState;
    const state = fsrsState ? fsrsState.state : State.New;

    if (state === State.New || !card.lastReviewed) {
      newCards.push(card);
    } else {
      const nextReviewDate = new Date(card.nextReview);
      if (nextReviewDate <= now) {
        if (state === State.Learning || state === State.Relearning) {
          learning.push(card);
        } else {
          due.push(card);
        }
      }
    }
  });

  due.sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime());
  learning.sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime());
  newCards.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const quota = await getRemainingNewCardQuota();

  return { due, learning, new: newCards.slice(0, quota), newTotalAvailable: newCards.length };
}

/**
 * Tracks an active study session.
 */
export class StudySession {
  constructor(categoryId = null) {
    this.id = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.categoryId = categoryId;
    this.startTime = new Date();
    this.endTime = null;
    this.cardsReviewed = 0;
    this.correctAnswers = 0;
  }

  /**
   * Submits a rating for a card, processes FSRS schedule, and logs the history.
   */
  async submitReview(card, rating) {
    const reviewDate = new Date();
    const { card: updatedCard, log } = schedule(card, rating, reviewDate);

    await flashcardRepository.put(updatedCard);
    await reviewHistoryRepository.create(log);

    this.cardsReviewed += 1;
    if (rating !== Rating.Again) {
      this.correctAnswers += 1;
    }

    if (this.categoryId) {
      const cards = await flashcardRepository.getByIndex('categoryId', this.categoryId);
      const activeCount = cards.filter((c) => !c.deleted).length;
      await categoryRepository.update(this.categoryId, { 
        totalCards: activeCount,
        lastOpened: reviewDate.toISOString()
      });
    }

    return { card: updatedCard, log };
  }

  /**
   * Ends the current study session and saves it to the database.
   */
  async end() {
    this.endTime = new Date();
    const durationMs = this.endTime.getTime() - this.startTime.getTime();
    const durationSec = Math.floor(durationMs / 1000);

    const sessionRecord = {
      id: this.id,
      categoryId: this.categoryId,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime.toISOString(),
      date: localDateStr(this.startTime), // local YYYY-MM-DD for indexing
      duration: durationSec,
      cardsReviewed: this.cardsReviewed,
      correctAnswers: this.correctAnswers,
    };

    if (this.cardsReviewed > 0) {
      await studySessionRepository.create(sessionRecord);
    }
    
    return sessionRecord;
  }
}

/**
 * Load grace-day settings. graceDates = YYYY-MM-DD[] already consumed.
 * lastUsed = YYYY-MM-DD of last consumption (for 7-day cooldown).
 */
async function loadGraceState() {
  let graceDates = [];
  try {
    const raw = await db.getSetting('streak_grace_dates', '[]');
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    if (Array.isArray(parsed)) {
      graceDates = parsed.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
    }
  } catch (e) { /* ignore */ }

  let lastUsed = '';
  try {
    lastUsed = String(await db.getSetting('streak_grace_last_used', '') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastUsed)) lastUsed = '';
  } catch (e) { /* ignore */ }

  return { graceDates, lastUsed };
}

async function saveGraceState(graceDates, lastUsed) {
  const unique = Array.from(new Set(graceDates)).sort();
  await db.setSetting('streak_grace_dates', JSON.stringify(unique));
  if (lastUsed) await db.setSetting('streak_grace_last_used', lastUsed);
}

/**
 * Auto-apply at most one grace day for a single missed calendar day that would
 * break the current streak. Looks at recent real-study history (not only the
 * gap from today) so studying after a miss still gets the free day.
 *
 * Rules:
 *   - exactly one missing day between two consecutive real study days, OR
 *     exactly one missing day between the newest study day and today
 *   - cooldown: at most 1 grace per 7 calendar days
 *   - grace is only for streak continuity — never for totalStudyDays / heatmaps
 */
async function maybeApplyGraceDay(uniqueDates, todayKey) {
  const { graceDates, lastUsed } = await loadGraceState();
  if (!uniqueDates.length) {
    return { graceDates, appliedGraceDate: null };
  }

  const todayIdx = dayIndex(todayKey);
  const studiedSet = new Set(uniqueDates);
  const graceSet = new Set(graceDates);

  // Cooldown gate: if last grace was within 7 days, do not apply another.
  if (lastUsed) {
    const daysSince = todayIdx - dayIndex(lastUsed);
    if (daysSince < 7) {
      return { graceDates, appliedGraceDate: null };
    }
  }

  // Newest → oldest day indices of real study days.
  const sortedIdx = uniqueDates
    .map((d) => dayIndex(d))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);

  // Candidate single-day gaps, newest first (prefer filling the most recent miss).
  const candidates = [];

  // Gap between newest study day and today (gap of exactly 2 calendar days).
  if (sortedIdx.length > 0) {
    const gapToToday = todayIdx - sortedIdx[0];
    if (gapToToday === 2) {
      candidates.push(sortedIdx[0] + 1);
    }
  }

  // Gaps of exactly 1 day between consecutive real study days (look back ~21 days).
  const lookbackFloor = todayIdx - 21;
  for (let i = 0; i < sortedIdx.length - 1; i++) {
    const newer = sortedIdx[i];
    const older = sortedIdx[i + 1];
    if (older < lookbackFloor) break;
    if (newer - older === 2) {
      candidates.push(older + 1);
    }
  }

  let missingIdx = null;
  for (const idx of candidates) {
    const dateStr = dateFromDayIndex(idx);
    if (studiedSet.has(dateStr) || graceSet.has(dateStr)) continue;
    // Prefer a gap that actually sits inside an otherwise continuous recent chain
    // (i.e. both neighbors exist as study or already-granted grace).
    const hasNewerNeighbor =
      studiedSet.has(dateFromDayIndex(idx + 1)) ||
      graceSet.has(dateFromDayIndex(idx + 1)) ||
      idx + 1 === todayIdx;
    const hasOlderNeighbor =
      studiedSet.has(dateFromDayIndex(idx - 1)) ||
      graceSet.has(dateFromDayIndex(idx - 1));
    if (hasNewerNeighbor && hasOlderNeighbor) {
      missingIdx = idx;
      break;
    }
    // Fallback: gap-to-today case (newer neighbor is "today" even if not studied yet).
    if (idx + 1 === todayIdx && hasOlderNeighbor) {
      missingIdx = idx;
      break;
    }
  }

  if (missingIdx === null) {
    return { graceDates, appliedGraceDate: null };
  }

  const missingDate = dateFromDayIndex(missingIdx);
  const nextGrace = [...graceDates, missingDate];
  await saveGraceState(nextGrace, todayKey);
  return { graceDates: nextGrace, appliedGraceDate: missingDate };
}

/** Short Persian weekday labels indexed by Date#getDay() (0=Sun … 6=Sat). */
const FA_WEEKDAY_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

/**
 * Last N calendar days for the streak strip widget.
 * studied = real session; grace = free day only (not real study).
 */
function buildWeekStrip(uniqueDates, graceDates, days = 7) {
  const studiedSet = new Set(uniqueDates);
  const graceSet = new Set(graceDates);
  const strip = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const studied = studiedSet.has(dateStr);
    const grace = !studied && graceSet.has(dateStr);
    strip.push({
      dateStr,
      label: FA_WEEKDAY_SHORT[d.getDay()],
      studied,
      grace,
      isToday: i === 0,
    });
  }
  return strip;
}

/**
 * Calculates current and historical study streaks based on studySessions history.
 * Supports a transparent "grace day" (روز آزاد): at most 1 free day per 7 days
 * when exactly one calendar day was missed. Grace dates never inflate totalStudyDays.
 *
 * Returns:
 *   currentStreak, longestStreak, totalStudyDays,
 *   usedGraceInCurrent (bool), graceDateInCurrent (string|null),
 *   weekStrip (last 7 days for UI)
 */
export async function calculateStreak() {
  const emptyStrip = buildWeekStrip([], [], 7);
  const sessions = await studySessionRepository.getAll();
  if (!sessions.length) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalStudyDays: 0,
      usedGraceInCurrent: false,
      graceDateInCurrent: null,
      weekStrip: emptyStrip,
    };
  }

  // Real study days only — used for totalStudyDays and as the base for grace.
  const uniqueDates = Array.from(
    new Set(sessions.map((s) => s.date).filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));
  const totalStudyDays = uniqueDates.length;

  const todayKey = localDateStr();
  const yest = new Date();
  yest.setHours(12, 0, 0, 0);
  yest.setDate(yest.getDate() - 1);
  const yesterdayKey = localDateStr(yest);

  // Soften a single missed day (cooldown-aware).
  const { graceDates, appliedGraceDate } = await maybeApplyGraceDay(uniqueDates, todayKey);

  // Effective set for streak continuity only.
  const effectiveSet = new Set([...uniqueDates, ...graceDates]);
  const hasDate = (dateStr) => effectiveSet.has(dateStr);

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let usedGraceInCurrent = false;
  let graceDateInCurrent = null;

  const isStreakActive = hasDate(todayKey) || hasDate(yesterdayKey);

  if (isStreakActive) {
    let checkDate = new Date();
    checkDate.setHours(12, 0, 0, 0);
    if (!hasDate(todayKey)) {
      checkDate = yest;
    }
    while (true) {
      const dateStr = localDateStr(checkDate);
      if (hasDate(dateStr)) {
        currentStreak++;
        if (graceDates.includes(dateStr) && !uniqueDates.includes(dateStr)) {
          usedGraceInCurrent = true;
          if (!graceDateInCurrent) graceDateInCurrent = dateStr;
        }
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // Longest streak on the same effective set (newest-first unique list).
  const effectiveSorted = Array.from(effectiveSet).sort((a, b) => b.localeCompare(a));
  if (effectiveSorted.length > 0) {
    tempStreak = 1;
    longestStreak = 1;
    for (let i = 1; i < effectiveSorted.length; i++) {
      const diffDays = dayIndex(effectiveSorted[i - 1]) - dayIndex(effectiveSorted[i]);
      if (diffDays === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  // If we just auto-applied grace this call, surface it for UI even if
  // the chain hasn't walked that date yet (edge cases around midnight).
  if (appliedGraceDate && !graceDateInCurrent) {
    usedGraceInCurrent = true;
    graceDateInCurrent = appliedGraceDate;
  }

  return {
    currentStreak,
    longestStreak,
    totalStudyDays,
    usedGraceInCurrent,
    graceDateInCurrent,
    weekStrip: buildWeekStrip(uniqueDates, graceDates, 7),
  };
}

/**
 * Most productive local hour (0–23) based on study_sessions.startTime.
 * Returns null when history is too thin to be meaningful.
 *
 * Thresholds (conservative, avoids random noise from a few sessions):
 *   - at least 20 sessions
 *   - spanning at least 7 distinct calendar days
 */
export async function getMostProductiveHour() {
  const sessions = await studySessionRepository.getAll();
  if (!sessions || sessions.length < 20) return null;

  const hourCounts = new Array(24).fill(0);
  const distinctDays = new Set();

  for (const s of sessions) {
    if (!s.startTime) continue;
    const d = new Date(s.startTime);
    if (Number.isNaN(d.getTime())) continue;
    hourCounts[d.getHours()] += 1;
    if (s.date) distinctDays.add(s.date);
    else distinctDays.add(localDateStr(d));
  }

  if (distinctDays.size < 7) return null;

  let bestHour = 0;
  let bestCount = -1;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > bestCount) {
      bestCount = hourCounts[h];
      bestHour = h;
    }
  }

  // Require a clear signal: top hour should appear at least a few times.
  if (bestCount < 3) return null;
  return bestHour;
}
