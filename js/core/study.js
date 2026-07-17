

import { flashcardRepository, reviewHistoryRepository, studySessionRepository, categoryRepository } from './repositories.js';
import { State, schedule, Rating } from './fsrs.js';

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

  // Sort: Overdue first, oldest created first
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

    // Save updated card and review log
    await flashcardRepository.put(updatedCard);
    await reviewHistoryRepository.create(log);

    // Update local statistics for this session
    this.cardsReviewed += 1;
    if (rating !== Rating.Again) {
      this.correctAnswers += 1;
    }

    // Increment category total cards if count got out of sync, or just let category refresh.
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
      date: this.startTime.toISOString().split('T')[0], // YYYY-MM-DD for indexing
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

  // Extract unique study days (YYYY-MM-DD format) sorted in descending order
  const uniqueDates = Array.from(new Set(sessions.map(s => s.date))).sort((a, b) => b.localeCompare(a));
  const totalStudyDays = uniqueDates.length;

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  // Verify if streak is active (meaning there's a study today or yesterday)
  const isStreakActive = uniqueDates.includes(todayStr) || uniqueDates.includes(yesterdayStr);

  if (isStreakActive) {
    // Start counting from today if the user already studied today; otherwise
    // (studied yesterday but not yet today) start from yesterday so the
    // streak isn't wrongly reported as broken/zero during the grace period
    // before the user's next session today.
    let checkDate = uniqueDates.includes(todayStr) ? new Date() : yesterday;
    // Start tracking current streak
    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      if (uniqueDates.includes(dateStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // Calculate historical longest streak
  if (uniqueDates.length > 0) {
    let checkDate = new Date(uniqueDates[0]);
    tempStreak = 1;
    longestStreak = 1;

    for (let i = 1; i < uniqueDates.length; i++) {
      const prevDate = new Date(uniqueDates[i]);
      const diffTime = Math.abs(checkDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
      checkDate = prevDate;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  return {
    currentStreak,
    longestStreak,
    totalStudyDays,
  };
}
