import { describe, expect, it } from "vitest";
import { TaskQueue } from "./task-queue";

describe("TaskQueue", () => {
  it("runs no more than the configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const states: number[] = [];
    const queue = new TaskQueue(2, (state) => states.push(state.active));

    const tasks = Array.from({ length: 5 }, (_, index) =>
      queue.enqueue(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) =>
          setTimeout(resolve, 5 + index),
        );
        active -= 1;
      }),
    );
    await Promise.all(tasks);

    expect(maxActive).toBe(2);
    expect(states).toContain(1);
    expect(states).toContain(2);
  });
});
