import type { FinalAwards } from "../models/awards";
import type { FinalGameResults, GameStats } from "../models/game-stats";
import type { CorrectGuess, RoundStats } from "../models/round-stats";
import { rankPlayerScores } from "./score-calculator";

const FASTEST_GUESSER_MINIMUM = 3;
const BEST_ARTIST_MINIMUM_DRAWS = 2;

interface TimedGuess extends CorrectGuess {
  roundNumber: number;
}

interface GuessEvent {
  playerId: string;
  timestamp: number;
  sequence: number;
  roundNumber: number;
  correct: boolean;
}

interface ArtistTally {
  playerId: string;
  draws: number;
  artistScore: number;
  correctGuesses: number;
  uniqueReactions: number;
}

interface CrowdTally {
  playerId: string;
  draws: number;
  uniqueReactors: number;
  drawingsReactedTo: number;
}

interface StreakTally {
  playerId: string;
  longestStreak: number;
  correctGuessCount: number;
}

export function calculateFinalAwards(stats: GameStats): FinalAwards {
  return {
    bestArtist: calculateBestArtist(stats.rounds),
    fastestGuesser: calculateFastestGuesser(stats.rounds),
    crowdFavorite: calculateCrowdFavorite(stats.rounds),
    streakMaster: calculateStreakMaster(stats.rounds),
  };
}

export function calculateFinalResults(stats: GameStats): FinalGameResults {
  const rankings = rankPlayerScores(stats.playerScores);
  return {
    rankings,
    winner: rankings[0] ?? null,
    awards: calculateFinalAwards(stats),
  };
}

function calculateFastestGuesser(rounds: RoundStats[]) {
  const guessesByPlayer = new Map<string, TimedGuess[]>();
  for (const round of rounds) {
    for (const guess of round.correctGuesses) {
      const guesses = guessesByPlayer.get(guess.playerId) ?? [];
      guesses.push({ ...guess, roundNumber: round.roundNumber });
      guessesByPlayer.set(guess.playerId, guesses);
    }
  }

  const candidates = [...guessesByPlayer.entries()]
    .filter(([, guesses]) => guesses.length >= FASTEST_GUESSER_MINIMUM)
    .map(([playerId, guesses]) => {
      const ordered = [...guesses].sort(compareTimedGuesses);
      const totalMs = ordered.reduce((sum, guess) => sum + guess.elapsedMs, 0);
      return {
        playerId,
        averageGuessTimeMs: totalMs / ordered.length,
        correctGuessCount: ordered.length,
        qualifyingAt: ordered[FASTEST_GUESSER_MINIMUM - 1].timestamp,
      };
    })
    .sort(
      (first, second) =>
        first.averageGuessTimeMs - second.averageGuessTimeMs ||
        second.correctGuessCount - first.correctGuessCount ||
        first.qualifyingAt - second.qualifyingAt ||
        compareIds(first.playerId, second.playerId),
    );

  const winner = candidates[0];
  if (!winner) return null;
  return {
    playerId: winner.playerId,
    averageGuessTimeMs: winner.averageGuessTimeMs,
    correctGuessCount: winner.correctGuessCount,
  };
}

function calculateBestArtist(rounds: RoundStats[]) {
  const tallies = new Map<string, ArtistTally>();
  for (const round of rounds) {
    const tally = tallies.get(round.drawerId) ?? {
      playerId: round.drawerId,
      draws: 0,
      artistScore: 0,
      correctGuesses: 0,
      uniqueReactions: 0,
    };
    const uniqueReactors = new Set(round.reactions.map((reaction) => reaction.playerId));
    const speedContribution = round.correctGuesses.reduce(
      (sum, guess) => sum + Math.max(0, 100 - guess.elapsedMs / 1000),
      0,
    );
    tally.draws += 1;
    tally.correctGuesses += round.correctGuesses.length;
    tally.uniqueReactions += uniqueReactors.size;
    tally.artistScore +=
      round.correctGuesses.length * 100 +
      speedContribution +
      (round.hintsUsed === 0 ? 100 : 0) +
      uniqueReactors.size * 25;
    tallies.set(round.drawerId, tally);
  }

  const winner = [...tallies.values()]
    .filter((tally) => tally.draws >= BEST_ARTIST_MINIMUM_DRAWS)
    .sort(
      (first, second) =>
        second.artistScore - first.artistScore ||
        second.correctGuesses - first.correctGuesses ||
        second.uniqueReactions - first.uniqueReactions ||
        compareIds(first.playerId, second.playerId),
    )[0];

  if (!winner) return null;
  return {
    playerId: winner.playerId,
    artistScore: winner.artistScore,
    correctGuesses: winner.correctGuesses,
    uniqueReactions: winner.uniqueReactions,
  };
}

function calculateCrowdFavorite(rounds: RoundStats[]) {
  const tallies = new Map<string, CrowdTally>();
  for (const round of rounds) {
    const tally = tallies.get(round.drawerId) ?? {
      playerId: round.drawerId,
      draws: 0,
      uniqueReactors: 0,
      drawingsReactedTo: 0,
    };
    const uniqueReactors = new Set(round.reactions.map((reaction) => reaction.playerId));
    tally.draws += 1;
    tally.uniqueReactors += uniqueReactors.size;
    if (uniqueReactors.size > 0) tally.drawingsReactedTo += 1;
    tallies.set(round.drawerId, tally);
  }

  const winner = [...tallies.values()]
    .filter((tally) => tally.draws > 0)
    .sort(
      (first, second) =>
        second.uniqueReactors - first.uniqueReactors ||
        second.drawingsReactedTo - first.drawingsReactedTo ||
        compareIds(first.playerId, second.playerId),
    )[0];

  if (!winner) return null;
  return {
    playerId: winner.playerId,
    uniqueReactors: winner.uniqueReactors,
    drawingsReactedTo: winner.drawingsReactedTo,
  };
}

function calculateStreakMaster(rounds: RoundStats[]) {
  const eventsByPlayer = new Map<string, GuessEvent[]>();
  for (const round of rounds) {
    for (const guess of round.correctGuesses) {
      appendGuessEvent(eventsByPlayer, {
        playerId: guess.playerId,
        timestamp: guess.timestamp,
        sequence: guess.sequence,
        roundNumber: round.roundNumber,
        correct: true,
      });
    }
    for (const guess of round.incorrectGuesses) {
      appendGuessEvent(eventsByPlayer, {
        playerId: guess.playerId,
        timestamp: guess.timestamp,
        sequence: guess.sequence,
        roundNumber: round.roundNumber,
        correct: false,
      });
    }
  }

  const tallies: StreakTally[] = [...eventsByPlayer.entries()].map(([playerId, events]) => {
    let currentStreak = 0;
    let longestStreak = 0;
    let correctGuessCount = 0;
    for (const event of events.sort(compareGuessEvents)) {
      if (event.correct) {
        currentStreak += 1;
        correctGuessCount += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    return { playerId, longestStreak, correctGuessCount };
  });

  const winner = tallies
    .filter((tally) => tally.longestStreak > 0)
    .sort(
      (first, second) =>
        second.longestStreak - first.longestStreak ||
        second.correctGuessCount - first.correctGuessCount ||
        compareIds(first.playerId, second.playerId),
    )[0];

  if (!winner) return null;
  return {
    playerId: winner.playerId,
    longestStreak: winner.longestStreak,
    correctGuessCount: winner.correctGuessCount,
  };
}

function appendGuessEvent(eventsByPlayer: Map<string, GuessEvent[]>, event: GuessEvent): void {
  const events = eventsByPlayer.get(event.playerId) ?? [];
  events.push(event);
  eventsByPlayer.set(event.playerId, events);
}

function compareTimedGuesses(first: TimedGuess, second: TimedGuess): number {
  return (
    first.timestamp - second.timestamp ||
    first.roundNumber - second.roundNumber ||
    first.sequence - second.sequence
  );
}

function compareGuessEvents(first: GuessEvent, second: GuessEvent): number {
  return (
    first.timestamp - second.timestamp ||
    first.roundNumber - second.roundNumber ||
    first.sequence - second.sequence
  );
}

function compareIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
