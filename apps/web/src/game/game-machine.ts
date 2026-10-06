import {
  addPlayerPoints,
  calculateFinalResults,
  calculateGuessScore,
  createGameStats,
  endRound,
  getCorrectGuesserIds,
  getRoundStats,
  recordGuess,
  recordHint,
  recordReaction,
  setDrawingStrokeCount,
  startRound,
} from "@doodlerush/game-engine";
import type {
  ChatEntry,
  DoodleRushState,
  DrawingStroke,
  GameSettings,
  MockGameSession,
} from "./mock-game-state";
import { createEmptyGame } from "./mock-game-state";
import { makeRoomPlayers } from "./mock-players";
import { makeRocketDrawing } from "./mock-drawing";
import { getMockDrawerWord, getRevealedPositions, getWordChoices } from "./mock-words";

export type GameAction =
  | { type: "PROFILE_CHANGED"; displayName?: string; avatar?: string }
  | { type: "HOME_ERROR"; field: "name" | "roomCode"; message: string }
  | { type: "ENTER_ROOM"; mode: "CREATE" | "QUICK_PLAY" | "JOIN"; roomCode: string }
  | { type: "SETTING_CHANGED"; setting: keyof GameSettings; value: number | string }
  | { type: "START_GAME" }
  | { type: "COUNTDOWN_TICK" }
  | { type: "SELECT_WORD"; word: string }
  | { type: "GAME_TICK" }
  | { type: "SUBMIT_GUESS"; guess: string }
  | { type: "SEND_CHAT"; text: string }
  | { type: "MOCK_WRONG_GUESS"; playerId: string; text: string }
  | { type: "MOCK_BOT_GUESS"; playerId: string }
  | { type: "MOCK_REACTION" }
  | { type: "USER_REACTION"; reaction: string }
  | { type: "DRAWING_CHANGED"; strokes: DrawingStroke[] }
  | { type: "UNDO_DRAWING" }
  | { type: "REDO_DRAWING" }
  | { type: "CLEAR_DRAWING" }
  | { type: "CLEAR_FEEDBACK" }
  | { type: "NEXT_ROUND" }
  | { type: "BEGIN_COUNTDOWN" }
  | { type: "PLAY_AGAIN" }
  | { type: "RETURN_LOBBY" }
  | { type: "RETURN_HOME" };

const USER_ID = "you";
const MAX_CHAT_MESSAGES = 80;

function appendChat(state: DoodleRushState, entry: Omit<ChatEntry, "id">): DoodleRushState {
  const nextId = state.messageSequence + 1;
  return {
    ...state,
    messageSequence: nextId,
    chat: [...state.chat, { ...entry, id: `message-${nextId}` }].slice(-MAX_CHAT_MESSAGES),
  };
}

function appendSystem(state: DoodleRushState, text: string): DoodleRushState {
  return appendChat(state, { kind: "system", text });
}

function replacePlayer(
  state: DoodleRushState,
  playerId: string,
  update: (player: DoodleRushState["players"][number]) => DoodleRushState["players"][number],
): DoodleRushState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? update(player) : player)),
  };
}

function roundStartedAt(game: MockGameSession, settings: GameSettings): number {
  return (game.roundNumber - 1) * settings.drawSeconds * 1_000;
}

function currentElapsedMs(game: MockGameSession, settings: GameSettings): number {
  return Math.max(0, settings.drawSeconds - game.secondsLeft) * 1_000;
}

function gameTimestamp(game: MockGameSession, settings: GameSettings): number {
  return roundStartedAt(game, settings) + currentElapsedMs(game, settings);
}

function allGuessersCorrect(state: DoodleRushState, game: MockGameSession): boolean {
  const correctGuessers = getCorrectGuesserIds(state.gameStats, game.roundNumber);
  const guessers = state.players.filter((player) => player.id !== game.drawerId);
  return guessers.every((player) => correctGuessers.includes(player.id));
}

function finishRound(state: DoodleRushState, game: MockGameSession): DoodleRushState {
  if (game.phase !== "DRAWING" || !game.answer) return state;

  const elapsedMs = currentElapsedMs(game, state.settings);
  let gameStats = setDrawingStrokeCount(state.gameStats, game.roundNumber, game.strokes.length);
  gameStats = endRound(
    gameStats,
    game.roundNumber,
    roundStartedAt(game, state.settings) + elapsedMs,
  );
  gameStats = addPlayerPoints(gameStats, game.drawerId, 100);
  const correctGuesserIds = getCorrectGuesserIds(gameStats, game.roundNumber);
  const drawerBonus = game.drawerId === state.playerId ? 100 : 0;

  let next: DoodleRushState = {
    ...state,
    gameStats,
    screen: "ROUND_RESULTS",
    game: {
      ...game,
      phase: "ROUND_END",
      secondsLeft: Math.max(0, game.secondsLeft),
      result: {
        answer: game.answer,
        drawerId: game.drawerId,
        pointsForCurrentPlayer: game.lastUserPoints,
        drawerBonusForCurrentPlayer: drawerBonus,
      },
    },
    players: state.players.map((player) => {
      if (player.id === game.drawerId || correctGuesserIds.includes(player.id)) return player;
      return { ...player, streak: 0 };
    }),
  };

  next = appendSystem(next, `Round ${game.roundNumber} complete. The word was ${game.answer}.`);
  return next;
}

function revealHintPositions(
  answer: string,
  settings: GameSettings,
  secondsLeft: number,
): number[] {
  const elapsed = settings.drawSeconds - secondsLeft;
  const interval = settings.drawSeconds / (settings.hints + 1);
  const hintCount = Math.min(settings.hints, Math.floor(elapsed / interval));
  return getRevealedPositions(answer, hintCount);
}

function beginRound(state: DoodleRushState, game: MockGameSession): DoodleRushState {
  if (game.drawerId === USER_ID) {
    const words = getWordChoices(game.roundNumber, state.settings.wordChoices);
    const next = {
      ...state,
      game: {
        ...game,
        phase: "WORD_SELECTION" as const,
        countdown: 0,
        secondsLeft: 0,
        wordOptions: words,
        answer: null,
      },
    };
    return appendSystem(next, "Pick a word to start your turn.");
  }

  const answer = getMockDrawerWord();
  const startedAt = roundStartedAt(game, state.settings);
  let gameStats = startRound(state.gameStats, {
    roundNumber: game.roundNumber,
    drawerId: game.drawerId,
    word: answer,
    startedAt,
  });
  const strokes = makeRocketDrawing();
  gameStats = setDrawingStrokeCount(gameStats, game.roundNumber, strokes.length);
  const next = {
    ...state,
    gameStats,
    game: {
      ...game,
      phase: "DRAWING" as const,
      countdown: 0,
      secondsLeft: state.settings.drawSeconds,
      answer,
      wordOptions: [],
      strokes,
      revealedPositions: [],
    },
  };
  const drawer = state.players.find((player) => player.id === game.drawerId);
  return appendSystem(next, `${drawer?.name ?? "A player"} is drawing!`);
}

function advanceAfterGuess(state: DoodleRushState, game: MockGameSession): DoodleRushState {
  return allGuessersCorrect(state, game) ? finishRound(state, game) : state;
}

function startNewGame(state: DoodleRushState): DoodleRushState {
  if (state.players.length < 2) return state;

  const players = state.players.map((player) => ({ ...player, streak: 0 }));
  const game: MockGameSession = {
    ...createEmptyGame(state.settings.rounds),
    phase: "COUNTDOWN",
    roundNumber: 1,
    totalRounds: state.settings.rounds,
    drawerId: state.players[0]?.id ?? state.playerId,
    countdown: 3,
    secondsLeft: 3,
  };
  const next = {
    ...state,
    screen: "GAME" as const,
    players,
    gameStats: createGameStats(players.map((player) => player.id)),
    finalResults: null,
    game,
    gameFeedback: "",
  };
  return appendSystem(next, "Game starting!");
}

export function gameReducer(state: DoodleRushState, action: GameAction): DoodleRushState {
  switch (action.type) {
    case "PROFILE_CHANGED":
      return {
        ...state,
        displayName: action.displayName ?? state.displayName,
        avatar: action.avatar ?? state.avatar,
        homeErrors: {},
      };
    case "HOME_ERROR":
      return { ...state, homeErrors: { ...state.homeErrors, [action.field]: action.message } };
    case "ENTER_ROOM": {
      const room = makeRoomPlayers(state.displayName, state.avatar, action.mode);
      const greeting = [
        { kind: "system" as const, text: `${state.displayName} joined the room.` },
        {
          kind: "chat" as const,
          playerId: room.players[0]?.id,
          playerName: room.players[0]?.name,
          text: "Ready when you are!",
        },
        {
          kind: "chat" as const,
          playerId: room.players[1]?.id,
          playerName: room.players[1]?.name,
          text: "Let’s make a masterpiece 😂",
        },
      ];
      let next: DoodleRushState = {
        ...state,
        screen: "LOBBY",
        roomCode: action.roomCode,
        hostId: room.hostId,
        players: room.players,
        gameStats: createGameStats(room.players.map((player) => player.id)),
        finalResults: null,
        game: createEmptyGame(state.settings.rounds),
        chat: [],
        messageSequence: 0,
        homeErrors: {},
        gameFeedback: "",
      };
      for (const message of greeting) next = appendChat(next, message);
      return next;
    }
    case "SETTING_CHANGED": {
      const setting = action.setting;
      const value = action.value;
      if (setting === "mode") {
        return {
          ...state,
          settings: { ...state.settings, mode: value === "Chill" ? "Chill" : "Normal" },
        };
      }
      if (typeof value !== "number") return state;
      return { ...state, settings: { ...state.settings, [setting]: value } };
    }
    case "START_GAME":
      return startNewGame(state);
    case "COUNTDOWN_TICK": {
      if (!state.game || state.game.phase !== "COUNTDOWN") return state;
      if (state.game.countdown > 1) {
        const countdown = state.game.countdown - 1;
        return { ...state, game: { ...state.game, countdown, secondsLeft: countdown } };
      }
      return beginRound(state, state.game);
    }
    case "SELECT_WORD": {
      const current = state.game;
      if (
        !current ||
        current.phase !== "WORD_SELECTION" ||
        current.drawerId !== state.playerId ||
        !current.wordOptions.includes(action.word)
      ) {
        return state;
      }
      const game: MockGameSession = {
        ...current,
        phase: "DRAWING",
        answer: action.word,
        wordOptions: [],
        secondsLeft: state.settings.drawSeconds,
        revealedPositions: [],
        strokes: [],
        redoStrokes: [],
        lastUserPoints: null,
        result: null,
      };
      const gameStats = startRound(state.gameStats, {
        roundNumber: game.roundNumber,
        drawerId: game.drawerId,
        word: action.word,
        startedAt: roundStartedAt(game, state.settings),
      });
      return appendSystem(
        { ...state, game, gameStats, gameFeedback: "" },
        "You’re drawing. Give them a good clue!",
      );
    }
    case "GAME_TICK": {
      const current = state.game;
      if (!current || current.phase !== "DRAWING") return state;
      const secondsLeft = Math.max(0, current.secondsLeft - 1);
      const revealedPositions = current.answer
        ? revealHintPositions(current.answer, state.settings, secondsLeft)
        : [];
      const nextGame = { ...current, secondsLeft, revealedPositions };
      let gameStats = state.gameStats;
      const previousHints = getRoundStats(gameStats, current.roundNumber)?.hintsUsed ?? 0;
      const elapsed = state.settings.drawSeconds - secondsLeft;
      const interval = state.settings.drawSeconds / (state.settings.hints + 1);
      const hintsNow = Math.min(state.settings.hints, Math.floor(elapsed / interval));
      for (let hint = previousHints; hint < hintsNow; hint += 1) {
        gameStats = recordHint(gameStats, current.roundNumber);
      }

      let next: DoodleRushState = { ...state, game: nextGame, gameStats };
      if (hintsNow > previousHints) {
        next = appendSystem(next, "A hint is up — a letter has been revealed.");
      }
      return secondsLeft === 0 ? finishRound(next, nextGame) : next;
    }
    case "SUBMIT_GUESS": {
      const game = state.game;
      const guess = action.guess.trim().slice(0, 40);
      if (
        !game ||
        game.phase !== "DRAWING" ||
        game.drawerId === state.playerId ||
        getCorrectGuesserIds(state.gameStats, game.roundNumber).includes(state.playerId) ||
        !guess
      ) {
        return state;
      }
      const normalizedGuess = guess.toLocaleLowerCase().replace(/\s+/g, " ");
      const normalizedAnswer = game.answer?.toLocaleLowerCase().replace(/\s+/g, " ");
      const elapsedMs = currentElapsedMs(game, state.settings);
      const timestamp = gameTimestamp(game, state.settings);
      const isCorrect = normalizedGuess === normalizedAnswer;

      if (!isCorrect) {
        let next = appendChat(state, {
          kind: "guess",
          playerId: state.playerId,
          playerName: state.displayName,
          text: guess,
        });
        next = {
          ...replacePlayer(next, state.playerId, (player) => ({ ...player, streak: 0 })),
          gameStats: recordGuess(next.gameStats, {
            roundNumber: game.roundNumber,
            playerId: state.playerId,
            timestamp,
            elapsedMs,
            correct: false,
          }),
          gameFeedback: "Not quite — take another guess!",
        };
        return next;
      }

      const previousStreak =
        state.players.find((player) => player.id === state.playerId)?.streak ?? 0;
      const points = calculateGuessScore(
        game.secondsLeft,
        state.settings.drawSeconds,
        previousStreak,
      );
      let next = replacePlayer(state, state.playerId, (player) => ({
        ...player,
        streak: points.streak,
      }));
      next = {
        ...next,
        gameStats: addPlayerPoints(
          recordGuess(next.gameStats, {
            roundNumber: game.roundNumber,
            playerId: state.playerId,
            timestamp,
            elapsedMs,
            correct: true,
          }),
          state.playerId,
          points.total,
        ),
      };
      next = appendChat(next, {
        kind: "correct",
        playerId: state.playerId,
        playerName: state.displayName,
        text: `guessed it! +${points.total}`,
      });
      const updatedGame: MockGameSession = { ...game, lastUserPoints: points };
      next = {
        ...next,
        game: updatedGame,
        gameFeedback: `Correct! +${points.total} points · streak ×${points.streak}`,
      };
      return advanceAfterGuess(next, updatedGame);
    }
    case "SEND_CHAT": {
      const text = action.text.trim().slice(0, 140);
      if (!text || !state.roomCode) return state;
      return appendChat(state, {
        kind: "chat",
        playerId: state.playerId,
        playerName: state.displayName,
        text,
      });
    }
    case "MOCK_WRONG_GUESS": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING") return state;
      const player = state.players.find((item) => item.id === action.playerId);
      if (
        !player ||
        player.id === game.drawerId ||
        getCorrectGuesserIds(state.gameStats, game.roundNumber).includes(player.id)
      ) {
        return state;
      }
      let next = appendChat(state, {
        kind: "guess",
        playerId: player.id,
        playerName: player.name,
        text: action.text,
      });
      next = {
        ...replacePlayer(next, player.id, (current) => ({ ...current, streak: 0 })),
        gameStats: recordGuess(next.gameStats, {
          roundNumber: game.roundNumber,
          playerId: player.id,
          timestamp: gameTimestamp(game, state.settings),
          elapsedMs: currentElapsedMs(game, state.settings),
          correct: false,
        }),
      };
      return next;
    }
    case "MOCK_BOT_GUESS": {
      const game = state.game;
      const player = state.players.find((item) => item.id === action.playerId);
      if (
        !game ||
        game.phase !== "DRAWING" ||
        !player ||
        player.id === game.drawerId ||
        getCorrectGuesserIds(state.gameStats, game.roundNumber).includes(player.id)
      ) {
        return state;
      }
      const points = calculateGuessScore(
        game.secondsLeft,
        state.settings.drawSeconds,
        player.streak,
      );
      let next = replacePlayer(state, player.id, (current) => ({
        ...current,
        streak: points.streak,
      }));
      next = {
        ...next,
        gameStats: addPlayerPoints(
          recordGuess(next.gameStats, {
            roundNumber: game.roundNumber,
            playerId: player.id,
            timestamp: gameTimestamp(game, state.settings),
            elapsedMs: currentElapsedMs(game, state.settings),
            correct: true,
          }),
          player.id,
          points.total,
        ),
      };
      next = appendChat(next, {
        kind: "correct",
        playerId: player.id,
        playerName: player.name,
        text: `guessed it! +${points.total}`,
      });
      return advanceAfterGuess(next, game);
    }
    case "MOCK_REACTION": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING") return state;
      const reactor = state.players.find((player) => player.id !== game.drawerId);
      const drawer = state.players.find((player) => player.id === game.drawerId);
      if (!reactor || !drawer) return state;
      const gameStats = recordReaction(state.gameStats, {
        roundNumber: game.roundNumber,
        playerId: reactor.id,
        reaction: "🔥",
        timestamp: gameTimestamp(game, state.settings),
      });
      if (gameStats === state.gameStats) return state;
      return appendSystem(
        { ...state, gameStats },
        `${drawer.name} got a reaction for that drawing.`,
      );
    }
    case "USER_REACTION": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING") return state;
      return {
        ...state,
        gameStats: recordReaction(state.gameStats, {
          roundNumber: game.roundNumber,
          playerId: state.playerId,
          reaction: action.reaction,
          timestamp: gameTimestamp(game, state.settings),
        }),
      };
    }
    case "DRAWING_CHANGED": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING" || game.drawerId !== state.playerId) return state;
      return {
        ...state,
        game: { ...game, strokes: action.strokes, redoStrokes: [] },
        gameStats: setDrawingStrokeCount(state.gameStats, game.roundNumber, action.strokes.length),
      };
    }
    case "UNDO_DRAWING": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING" || game.drawerId !== state.playerId) return state;
      const removed = game.strokes[game.strokes.length - 1];
      if (!removed) return state;
      const strokes = game.strokes.slice(0, -1);
      return {
        ...state,
        game: { ...game, strokes, redoStrokes: [...game.redoStrokes, removed] },
        gameStats: setDrawingStrokeCount(state.gameStats, game.roundNumber, strokes.length),
      };
    }
    case "REDO_DRAWING": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING" || game.drawerId !== state.playerId) return state;
      const restored = game.redoStrokes[game.redoStrokes.length - 1];
      if (!restored) return state;
      const strokes = [...game.strokes, restored];
      return {
        ...state,
        game: { ...game, strokes, redoStrokes: game.redoStrokes.slice(0, -1) },
        gameStats: setDrawingStrokeCount(state.gameStats, game.roundNumber, strokes.length),
      };
    }
    case "CLEAR_DRAWING": {
      const game = state.game;
      if (!game || game.phase !== "DRAWING" || game.drawerId !== state.playerId) return state;
      return {
        ...state,
        game: { ...game, strokes: [], redoStrokes: [] },
        gameStats: setDrawingStrokeCount(state.gameStats, game.roundNumber, 0),
      };
    }
    case "CLEAR_FEEDBACK":
      return { ...state, gameFeedback: "" };
    case "NEXT_ROUND": {
      const game = state.game;
      if (!game || game.phase !== "ROUND_END") return state;
      if (game.roundNumber >= game.totalRounds) {
        const finalResults = calculateFinalResults(state.gameStats);
        return {
          ...state,
          screen: "GAME_RESULTS",
          finalResults,
          game: { ...game, phase: "GAME_END" },
        };
      }
      const roundNumber = game.roundNumber + 1;
      const drawerIndex = (roundNumber - 1) % state.players.length;
      const drawerId = state.players[drawerIndex]?.id ?? state.playerId;
      return {
        ...state,
        screen: "GAME",
        game: {
          ...createEmptyGame(game.totalRounds),
          phase: "NEXT_ROUND",
          roundNumber,
          totalRounds: game.totalRounds,
          drawerId,
          countdown: 3,
        },
        gameFeedback: "",
      };
    }
    case "BEGIN_COUNTDOWN":
      if (!state.game || state.game.phase !== "NEXT_ROUND") return state;
      return {
        ...state,
        game: { ...state.game, phase: "COUNTDOWN", countdown: 3, secondsLeft: 3 },
      };
    case "PLAY_AGAIN": {
      if (!state.roomCode) return state;
      const players = state.players.map((player) => ({ ...player, streak: 0 }));
      const next = {
        ...state,
        screen: "LOBBY" as const,
        players,
        gameStats: createGameStats(players.map((player) => player.id)),
        finalResults: null,
        game: createEmptyGame(state.settings.rounds),
        gameFeedback: "",
      };
      return appendSystem(next, "Rematch ready! The scores are reset.");
    }
    case "RETURN_LOBBY":
      if (!state.roomCode) return state;
      return {
        ...state,
        screen: "LOBBY",
        finalResults: null,
        game: createEmptyGame(state.settings.rounds),
        gameFeedback: "",
      };
    case "RETURN_HOME":
      return {
        ...state,
        screen: "HOME",
        roomCode: "",
        hostId: "",
        players: [],
        gameStats: createGameStats(),
        finalResults: null,
        game: null,
        chat: [],
        messageSequence: 0,
        homeErrors: {},
        gameFeedback: "",
      };
    default:
      return state;
  }
}
