import type { DrawingStroke } from "./mock-game-state";

export function makeRocketDrawing(): DrawingStroke[] {
  return [
    {
      id: "rocket-body",
      color: "#304c72",
      size: 5,
      tool: "pen",
      points: [
        { x: 0.5, y: 0.18 },
        { x: 0.62, y: 0.34 },
        { x: 0.64, y: 0.65 },
        { x: 0.5, y: 0.78 },
        { x: 0.36, y: 0.65 },
        { x: 0.38, y: 0.34 },
        { x: 0.5, y: 0.18 },
      ],
    },
    {
      id: "rocket-fin-left",
      color: "#f27d5c",
      size: 5,
      tool: "pen",
      points: [
        { x: 0.38, y: 0.55 },
        { x: 0.27, y: 0.72 },
        { x: 0.39, y: 0.68 },
      ],
    },
    {
      id: "rocket-fin-right",
      color: "#f27d5c",
      size: 5,
      tool: "pen",
      points: [
        { x: 0.62, y: 0.55 },
        { x: 0.73, y: 0.72 },
        { x: 0.61, y: 0.68 },
      ],
    },
    {
      id: "rocket-window",
      color: "#54b9c2",
      size: 4,
      tool: "pen",
      points: [
        { x: 0.5, y: 0.36 },
        { x: 0.55, y: 0.42 },
        { x: 0.5, y: 0.48 },
        { x: 0.45, y: 0.42 },
        { x: 0.5, y: 0.36 },
      ],
    },
    {
      id: "rocket-flame",
      color: "#f6b94b",
      size: 5,
      tool: "pen",
      points: [
        { x: 0.43, y: 0.78 },
        { x: 0.47, y: 0.9 },
        { x: 0.5, y: 0.82 },
        { x: 0.54, y: 0.91 },
        { x: 0.57, y: 0.78 },
      ],
    },
  ];
}
