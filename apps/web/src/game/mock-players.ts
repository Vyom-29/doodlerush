import type { MockPlayer } from "./mock-game-state";

export const AVATARS = [
  { emoji: "😎", label: "Cool" },
  { emoji: "🤖", label: "Robot" },
  { emoji: "👻", label: "Ghost" },
  { emoji: "🐸", label: "Frog" },
  { emoji: "🦊", label: "Fox" },
  { emoji: "🐼", label: "Panda" },
  { emoji: "🐱", label: "Cat" },
  { emoji: "🦄", label: "Unicorn" },
  { emoji: "🦖", label: "Dinosaur" },
  { emoji: "🐙", label: "Octopus" },
  { emoji: "🐝", label: "Bee" },
  { emoji: "🦉", label: "Owl" },
  { emoji: "🐸", label: "Toad" },
  { emoji: "🐧", label: "Penguin" },
  { emoji: "🦋", label: "Butterfly" },
  { emoji: "🐲", label: "Dragon" },
];

const MOCK_PLAYERS: Array<Pick<MockPlayer, "id" | "name" | "avatar">> = [
  { id: "mock-rahul", name: "Rahul", avatar: "🦊" },
  { id: "mock-sam", name: "Sam", avatar: "🤖" },
  { id: "mock-maya", name: "Maya", avatar: "👻" },
  { id: "mock-jordan", name: "Jordan", avatar: "🐸" },
];

const JOIN_HOST: Pick<MockPlayer, "id" | "name" | "avatar"> = {
  id: "mock-alex",
  name: "Alex",
  avatar: "🧢",
};

export function makePlayer(
  player: Pick<MockPlayer, "id" | "name" | "avatar">,
  isReady = true,
): MockPlayer {
  return {
    ...player,
    isReady,
    streak: 0,
  };
}

export function makeRoomPlayers(
  displayName: string,
  avatar: string,
  mode: "CREATE" | "QUICK_PLAY" | "JOIN",
): { players: MockPlayer[]; hostId: string } {
  const currentPlayer = makePlayer({ id: "you", name: displayName, avatar });

  if (mode === "JOIN") {
    const host = makePlayer(JOIN_HOST);
    const guests = MOCK_PLAYERS.filter((player) => player.id !== "mock-maya")
      .slice(0, 3)
      .map((player) => makePlayer(player));

    return {
      players: [host, currentPlayer, ...guests],
      hostId: JOIN_HOST.id,
    };
  }

  return {
    players: [currentPlayer, ...MOCK_PLAYERS.map((player) => makePlayer(player))],
    hostId: currentPlayer.id,
  };
}

export function randomAvatar(current: string): string {
  const choices = AVATARS.filter((avatar) => avatar.emoji !== current);
  return choices[Math.floor(Math.random() * choices.length)]?.emoji ?? AVATARS[0].emoji;
}

export function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 5 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
