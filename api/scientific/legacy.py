"""Generic bounded grid A* kept for the original API contract and unit tests (4-neighbour, cost grid)."""
from __future__ import annotations

from heapq import heappop, heappush


def astar(costs: list[list[float]], start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]]:
    """Deterministic 4-neighbour A*; non-finite cells are blocked (missing data stays impassable)."""
    rows, cols = len(costs), len(costs[0]) if costs else 0
    if not rows or not (0 <= start[0] < rows and 0 <= start[1] < cols and 0 <= goal[0] < rows and 0 <= goal[1] < cols):
        raise ValueError("Invalid grid or endpoints")
    frontier: list[tuple[float, tuple[int, int]]] = [(0, start)]
    came: dict[tuple[int, int], tuple[int, int]] = {}
    score = {start: 0.0}
    while frontier:
        _, current = heappop(frontier)
        if current == goal:
            path = [current]
            while current in came:
                current = came[current]
                path.append(current)
            return list(reversed(path))
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nxt = current[0] + dr, current[1] + dc
            if not (0 <= nxt[0] < rows and 0 <= nxt[1] < cols):
                continue
            step = costs[nxt[0]][nxt[1]]
            if step != step or step == float("inf"):
                continue
            candidate = score[current] + max(0, step)
            if candidate < score.get(nxt, float("inf")):
                score[nxt], came[nxt] = candidate, current
                heappush(frontier, (candidate + abs(goal[0] - nxt[0]) + abs(goal[1] - nxt[1]), nxt))
    raise ValueError("No traversable route")
