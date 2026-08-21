

import { flashcardRepository, reviewHistoryRepository, studySessionRepository, categoryRepository } from './repositories.js';
import { State, schedule, Rating } from './fsrs.js';

/** Local calendar YYYY-MM-DD (avoids UTC day-shift for Iran UTC+3:30). */
export function localDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return localDateStr(new Date());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Retrieves the study queues for a specific category or globally.
 * Returns { due: Card[], learning: Card[], new: Card[] }
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

  return { due, learning, new: newCards };
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
 * Calculates current and historical study streaks based on studySessions history.
 */
export async function calculateStreak() {
  const sessions = await studySessionRepository.getAll();
  if (!sessions.length) {
    return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0 };
  }

  const uniqueDates = Array.from(new Set(sessions.map(s => s.date).filter(Boolean))).sort((a, b) => b.localeCompare(a));
  const totalStudyDays = uniqueDates.length;

  const todayKey = localDateStr();
  const yest = new Date();
  yest.setHours(12, 0, 0, 0);
  yest.setDate(yest.getDate() - 1);
  const yesterdayKey = localDateStr(yest);

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  const isStreakActive = uniqueDates.includes(todayKey) || uniqueDates.includes(yesterdayKey);

  if (isStreakActive) {
    let checkDate = new Date();
    checkDate.setHours(12, 0, 0, 0);
    if (!uniqueDates.includes(todayKey)) {
      checkDate = yest;
    }
    while (true) {
      const dateStr = localDateStr(checkDate);
      if (uniqueDates.includes(dateStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  if (uniqueDates.length > 0) {
    // uniqueDates is newest-first. Compare consecutive calendar days via UTC day index of the Y-M-D parts.
    const dayIndex = (s) => {
      const [y, m, d] = String(s).split('-').map(Number);
      return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
    };
    tempStreak = 1;
    longestStreak = 1;
    for (let i = 1; i < uniqueDates.length; i++) {
      const diffDays = dayIndex(uniqueDates[i - 1]) - dayIndex(uniqueDates[i]);
      if (diffDays === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  return {
    currentStreak,
    longestStreak,
    totalStudyDays,
  };
}
