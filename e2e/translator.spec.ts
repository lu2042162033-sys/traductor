import { expect, test } from "@playwright/test";

const sseBody = [
  'event: source\ndata: {"type":"source","text":"Good morning."}\n\n',
  'event: translation\ndata: {"type":"translation","text":"早上"}\n\n',
  'event: translation\ndata: {"type":"translation","text":"好。"}\n\n',
  'event: done\ndata: {"type":"done","latencyMs":1200}\n\n',
].join("");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/interpret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBody,
    });
  });
});

test("translates fake microphone audio and restores it after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始翻译" }).click();

  await expect(page.getByText("Good morning.").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("早上好。").first()).toBeVisible();
  await page.getByRole("button", { name: "停止并保存" }).click();

  await page.reload();
  await expect(page.getByText("Good morning.").first()).toBeVisible();
  await expect(page.getByText("早上好。").first()).toBeVisible();
});

test("exports the current record as Markdown", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始翻译" }).click();
  await expect(page.getByText("Good morning.").first()).toBeVisible({
    timeout: 15_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^traductor-\d{8}-\d{6}\.md$/,
  );
  await page.getByRole("button", { name: "停止并保存" }).click();
});
