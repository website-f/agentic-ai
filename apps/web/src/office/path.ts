/** Breadth-first search on the collision grid (pixel-agents style). 4-directional, so
 * walks look like grid movement. Returns the tiles to visit after `from`, ending at `to`. */
export function findPath(
  width: number,
  height: number,
  walkable: boolean[],
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const idx = (x: number, y: number) => y * width + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(from.x, from.y) || !inside(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const start = idx(from.x, from.y);
  const goal = idx(to.x, to.y);
  const prev = new Int32Array(width * height).fill(-1);
  prev[start] = start;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goal) break;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (let d = 0; d < 8; d += 2) {
      const nx = cx + dirs[d]!;
      const ny = cy + dirs[d + 1]!;
      if (!inside(nx, ny)) continue;
      const n = idx(nx, ny);
      // The goal may be a seat that is not otherwise walkable.
      if (prev[n] !== -1 || (!walkable[n] && n !== goal)) continue;
      prev[n] = cur;
      queue[tail++] = n;
    }
  }
  if (prev[goal] === -1) return null;
  const out: { x: number; y: number }[] = [];
  for (let cur = goal; cur !== start; cur = prev[cur]!) out.push({ x: cur % width, y: Math.floor(cur / width) });
  return out.reverse();
}
