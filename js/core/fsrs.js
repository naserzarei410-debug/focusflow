

// Default FSRS weights (v4 standard parameters)
const WEIGHTS = [
  0.4, 0.6, 2.4, 5.8, 
  4.93, 0.94, 0.86, 0.01, 
  1.49, 0.14, 0.94, 2.18, 
  0.05, 0.34, 1.26, 0.26, 2.05
];

export const Rating = {
  Again: 1, // Forgot / incorrect
  Hard: 2,  // Slower recall
  Good: 3,  // Normal / correct
  Easy: 4,  // Instant recall
};

export const State = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
};

/**
 * Calculates current retrievability of a card.
 * R = (1 + t / (9 * S))^-1
 */
export function calculateRetrievability(stability, elapsedDays) {
  if (elapsedDays <= 0) return 1.0;
  return Math.pow(1 + elapsedDays / (9 * stability), -1);
}

/**
 * Calculates interval (in days) for a given stability and desired retrievability.
 * Default desired retrievability is 0.90 (90% target retention rate).
 */
export function calculateInterval(stability, requestRetention = 0.9) {
  const interval = 9 * stability * (1 / requestRetention - 1);
  return Math.max(1, Math.round(interval));
}

function initDifficulty(rating) {
  return Math.min(Math.max(WEIGHTS[4] - WEIGHTS[5] * (rating - 3), 1), 10);
}

function initStability(rating) {
  return WEIGHTS[rating - 1];
}

function updateDifficulty(currentDifficulty, rating) {
  const nextD = currentDifficulty - WEIGHTS[6] * (rating - 3);
  const meanReversion = WEIGHTS[7] * initDifficulty(Rating.Good) + (1 - WEIGHTS[7]) * nextD;
  return Math.min(Math.max(meanReversion, 1), 10);
}

function updateStabilitySuccess(currentStability, currentDifficulty, retrievability, rating) {
  const hardPenalty = rating === Rating.Hard ? WEIGHTS[15] : 1.0;
  const easyBonus = rating === Rating.Easy ? WEIGHTS[16] : 1.0;
  
  const multiplier = 1 + Math.exp(WEIGHTS[8]) * 
    (11 - currentDifficulty) * 
    Math.pow(currentStability, -WEIGHTS[9]) * 
    (Math.exp((1 - retrievability) * WEIGHTS[10]) - 1) * 
    hardPenalty * 
    easyBonus;
    
  return currentStability * multiplier;
}

function updateStabilityFailure(currentStability, currentDifficulty, retrievability) {
  const nextS = WEIGHTS[11] * 
    Math.pow(currentDifficulty, -WEIGHTS[12]) * 
    (Math.pow(currentStability + 1, WEIGHTS[13]) - 1) * 
    Math.exp((1 - retrievability) * WEIGHTS[14]);
    
  return Math.min(nextS, currentStability);
}

/**
 * Core FSRS Scheduler.
 * Takes a card, the review rating, and review timestamp, and calculates the updated scheduling states.
 */
export function schedule(card, rating, reviewDate = new Date()) {
  const cardState = card.fsrsState || {
    stability: 0.1,
    difficulty: 5.0,
    state: State.New,
  };
  
  const previousState = cardState.state ?? State.New;
  const previousStability = Math.max(0.1, cardState.stability ?? 0.1);
  const previousDifficulty = Math.min(Math.max(cardState.difficulty ?? 5.0, 1.0), 10.0);
  
  let elapsedDays = 0;
  if (card.lastReviewed) {
    const lastRev = new Date(card.lastReviewed);
    if (!isNaN(lastRev.getTime())) {
      const diffTime = Math.abs(reviewDate.getTime() - lastRev.getTime());
      elapsedDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    }
  }
  if (isNaN(elapsedDays)) elapsedDays = 0;

  let nextStability = 0.1;
  let nextDifficulty = 5.0;
  let nextState = State.Review;

  // 1. Initial review of a new card
  if (previousState === State.New) {
    nextStability = initStability(rating);
    nextDifficulty = initDifficulty(rating);
    nextState = (rating === Rating.Again || rating === Rating.Hard) ? State.Learning : State.Review;
  } 
  // 2. Learning or relearning phase
  else if (previousState === State.Learning || previousState === State.Relearning) {
    if (rating === Rating.Again || rating === Rating.Hard) {
      nextStability = rating === Rating.Again ? previousStability * 0.5 : previousStability * 0.9;
      nextDifficulty = rating === Rating.Again 
        ? Math.min(previousDifficulty + 1.0, 10.0)
        : Math.min(previousDifficulty + 0.5, 10.0);
      nextState = previousState;
    } else {
      nextStability = previousStability * 1.5; // Gain stability on success
      nextDifficulty = updateDifficulty(previousDifficulty, rating);
      nextState = State.Review;
    }
  } 
  // 3. Review state (card already graduated)
  else {
    const r = calculateRetrievability(previousStability, elapsedDays);
    nextDifficulty = updateDifficulty(previousDifficulty, rating);
    
    if (rating === Rating.Again) {
      nextStability = updateStabilityFailure(previousStability, nextDifficulty, r);
      nextState = State.Relearning;
    } else {
      nextStability = updateStabilitySuccess(previousStability, nextDifficulty, r, rating);
      nextState = State.Review;
    }
  }

  // Sanitize nextStability and nextDifficulty to prevent NaN or division-by-zero propagation
  if (isNaN(nextStability) || nextStability <= 0 || !isFinite(nextStability)) {
    nextStability = 0.1;
  }
  if (isNaN(nextDifficulty) || nextDifficulty < 1 || nextDifficulty > 10 || !isFinite(nextDifficulty)) {
    nextDifficulty = 5.0;
  }

  // Calculate the actual next review date.
  // Cards still inside the Learning/Relearning phase use short minute-based
  // steps (a standard sub-day "cramming" step before a card graduates).
  // Once a card reaches the Review state, the interval MUST come from the
  // FSRS stability value (in days) — that's the whole point of spaced
  // repetition. Previously this used fixed minute steps for EVERY rating,
  // so graduated cards kept coming back within minutes instead of days or
  // weeks, and nextStability/nextDifficulty were computed but never used.
  let nextReviewDate;
  if (
    previousState === State.New ||
    previousState === State.Learning ||
    previousState === State.Relearning ||
    nextState === State.Learning ||
    nextState === State.Relearning
  ) {
    let minutesInterval = 1;
    try {
      const savedAgain = localStorage.getItem('interval_again');
      const savedHard = localStorage.getItem('interval_hard');
      const savedGood = localStorage.getItem('interval_good');
      const savedEasy = localStorage.getItem('interval_easy');

      if (rating === Rating.Again) {
        minutesInterval = savedAgain ? parseInt(savedAgain, 10) : 1;
      } else if (rating === Rating.Hard) {
        minutesInterval = savedHard ? parseInt(savedHard, 10) : 2;
      } else if (rating === Rating.Good) {
        minutesInterval = savedGood ? parseInt(savedGood, 10) : 4;
      } else if (rating === Rating.Easy) {
        minutesInterval = savedEasy ? parseInt(savedEasy, 10) : 8;
      }
    } catch (e) {
      if (rating === Rating.Hard) minutesInterval = 2;
      else if (rating === Rating.Good) minutesInterval = 4;
      else if (rating === Rating.Easy) minutesInterval = 8;
    }
    nextReviewDate = new Date(reviewDate.getTime() + minutesInterval * 60 * 1000);
  } else {
    const intervalDays = calculateInterval(nextStability);
    nextReviewDate = new Date(reviewDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  }

  const updatedCard = {
    ...card,
    lastReviewed: reviewDate.toISOString(),
    nextReview: nextReviewDate.toISOString(),
    reviewCount: (card.reviewCount || 0) + 1,
    difficulty: nextDifficulty,
    fsrsState: {
      stability: nextStability,
      difficulty: nextDifficulty,
      state: nextState,
    },
  };

  const reviewHistoryLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    cardId: card.id,
    reviewDate: reviewDate.toISOString(),
    selectedDifficulty: rating,
    elapsedDays,
    scheduledDays: (nextReviewDate.getTime() - reviewDate.getTime()) / (24 * 60 * 60 * 1000),
    stability: nextStability,
    difficulty: nextDifficulty,
    retrievability: calculateRetrievability(nextStability, elapsedDays),
  };

  return {
    card: updatedCard,
    log: reviewHistoryLog,
  };
}
