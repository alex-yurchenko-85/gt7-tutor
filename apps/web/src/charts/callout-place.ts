import type { Point } from './geometry.ts';

export type Box = { x: number; y: number; width: number; height: number };

export type CalloutPlaceInput = {
  anchor: Point;
  normal: Point;
  side: 1 | -1;
  width: number;
  height: number;
  leader: number;
  bounds: { width: number; height: number };
  margin: number;
  clearance: number;
  obstacles: Point[];
  taken: Box[];
};

export type CalloutPlace = { box: Box; end: Point };

const LEADER_STEPS = [1, 1.5, 2, 3];
const SHIFTS = [0, 0.5, -0.5];
const TAKEN_PENALTY = 1_000_000;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function coveredPoints(box: Box, points: Point[], clearance: number): number {
  let count = 0;
  for (const [x, y] of points) {
    if (x >= box.x - clearance && x <= box.x + box.width + clearance && y >= box.y - clearance && y <= box.y + box.height + clearance) count++;
  }
  return count;
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

function candidates(input: CalloutPlaceInput): Box[] {
  const { anchor, normal, side, width, height, leader, bounds, margin } = input;
  const boxes: Box[] = [];
  for (const step of LEADER_STEPS) {
    for (const direction of [side, -side]) {
      const dx = normal[0] * direction;
      const dy = normal[1] * direction;
      const endX = anchor[0] + dx * leader * step;
      const endY = anchor[1] + dy * leader * step;
      for (const shift of SHIFTS) {
        const centreX = endX + (dx * width) / 2 - dy * shift * width;
        const centreY = endY + (dy * height) / 2 + dx * shift * height;
        boxes.push({
          x: clamp(centreX - width / 2, margin, bounds.width - margin - width),
          y: clamp(centreY - height / 2, margin, bounds.height - margin - height),
          width,
          height
        });
      }
    }
  }
  return [...boxes, ...gridBoxes(input)];
}

function gridBoxes({ anchor, width, height, bounds, margin }: CalloutPlaceInput): Box[] {
  const boxes: Box[] = [];
  const stepX = width / 4;
  const stepY = height / 2;
  for (let x = margin; x <= bounds.width - margin - width; x += stepX) {
    for (let y = margin; y <= bounds.height - margin - height; y += stepY) boxes.push({ x, y, width, height });
  }
  const distance = (box: Box) => Math.hypot(box.x + width / 2 - anchor[0], box.y + height / 2 - anchor[1]);
  return boxes.sort((a, b) => distance(a) - distance(b));
}

export function placeCallout(input: CalloutPlaceInput): CalloutPlace {
  let best: Box | null = null;
  let bestScore = Infinity;
  for (const box of candidates(input)) {
    const score = coveredPoints(box, input.obstacles, input.clearance) + (input.taken.some(other => overlaps(box, other, input.clearance)) ? TAKEN_PENALTY : 0);
    if (score < bestScore) {
      best = box;
      bestScore = score;
    }
    if (score === 0) break;
  }
  const box = best!;
  return { box, end: [clamp(input.anchor[0], box.x, box.x + box.width), clamp(input.anchor[1], box.y, box.y + box.height)] };
}
