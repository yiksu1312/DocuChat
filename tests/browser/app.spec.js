import { test, expect } from '@playwright/test';
import path from 'node:path';
const fixture = name => path.resolve('fixtures', name);
async function upload(page, name) {
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(fixture(name));
  await expect(page.locator('.document-item').filter({ hasText: name }).getByText('可用', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.scope-banner')).toContainText(name);
}
async function ask(page, text) {
  await page.getByRole('textbox', { name: '文档问题' }).fill(text);
  await page.getByRole('button', { name: '提问', exact: true }).click();
}
async function complete(page) { await expect(page.getByText('含来源引用 · 请核对原文', { exact: true }).last()).toBeVisible(); }
test.beforeEach(async ({ request, page }) => {
  await page.addInitScript(() => localStorage.setItem('docuchat-language','zh-CN'));
  // This server uses its own disposable data directory, never the user's data.
  for (const d of (await (await request.get('/api/documents')).json()).documents) await request.delete('/api/documents/' + d.documentId);
});
test('documents, persisted sessions, scoped questions, references, deletion and responsive layout', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'DocuChat', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '文档问题' })).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles(fixture('invalid.txt'));
  await expect(page.getByRole('alert').last()).toContainText('PDF');
  await upload(page, 'orchid.pdf'); await ask(page, 'What is the launch code?'); await complete(page);
  await expect(page.locator('.answer').last()).toContainText('ORCHID-742');
  await expect(page.locator('.sources-panel blockquote')).toContainText('ORCHID-742');
  const link = page.getByRole('link', { name: '打开 PDF 第 1 页' }).first();
  await expect(link).toHaveAttribute('href', /\/api\/documents\/.+\/file#page=1$/);
  const url = await link.getAttribute('href'); expect((await page.request.get(url.split('#')[0])).status()).toBe(200);
  await page.reload(); await expect(page.locator('.answer')).toContainText('ORCHID-742');
  await expect(page.locator('.scope-banner')).toContainText('orchid.pdf');
  await upload(page, 'orchid.pdf');
  await expect(page.getByRole('alert').last()).toContainText('复用');
  await expect(page.locator('.document-item')).toHaveCount(1);
  await upload(page, 'cedar.pdf'); await page.getByRole('button', { name: '选择全部可用' }).click();
  await expect(page.locator('.scope-banner')).toContainText('本次范围（2）');
  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page.locator('.exchange')).toHaveCount(0);
  await ask(page, 'Compare the projects.'); await complete(page);
  await expect(page.locator('.message-scope')).toContainText('orchid.pdf');
  await expect(page.locator('.message-scope')).toContainText('cedar.pdf');
  await page.locator('.sources-panel details').last().locator('summary').click();
  await expect(page.locator('.sources-panel')).toContainText('CEDAR-219');
  await expect(page.locator('.sources-panel')).toContainText('ORCHID-742');
  await page.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'What is the launch code?' }).click();
  await expect(page.locator('.answer')).toContainText('ORCHID-742');
  await expect(page.locator('.scope-banner')).toContainText('本次范围（2）');
  await expect(page.locator('.message-scope')).not.toContainText('cedar.pdf');
  await page.getByRole('checkbox', { name: 'cedar.pdf' }).uncheck();
  await page.getByRole('button', { name: '查看引用与检索片段' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/docuchat-stage2-desktop.png', fullPage: true });
  await page.locator('.document-item').filter({ hasText: 'orchid.pdf' }).getByRole('button', { name: /删\s*除/, exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.locator('.sources-panel')).toContainText('来源已删除');
  await expect(page.locator('.answer')).toContainText('ORCHID-742');
  await expect(page.getByRole('textbox', { name: '文档问题' })).toBeDisabled();
  await page.reload(); await expect(page.locator('.sources-panel')).toContainText('来源已删除');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/docuchat-stage2-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('streaming cancellation and session switching ignore delayed old events; clear persists', async ({ page }) => {
  await page.goto('/'); await upload(page, 'orchid.pdf');
  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page.locator('.exchange')).toHaveCount(0);
  await ask(page, 'stop test');
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止 · 内容未完成')).toBeVisible();
  // Delay the entire old response; switching must invalidate its captured generation.
  let release; const gate = new Promise(r => release = r);
  await page.route('**/api/chat', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: ' + JSON.stringify({ answer: 'STALE_ANSWER', supported: false, citations: [], retrieved: [] }) + '\n\n' }).catch(() => {});
  });
  await ask(page, 'old session');
  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page.locator('.exchange')).toHaveCount(0);
  release(); await page.unroute('**/api/chat');
  await ask(page, 'fresh session'); await complete(page);
  await expect(page.locator('.answer')).not.toContainText('STALE_ANSWER');
  await expect(page.locator('.question')).toHaveText('fresh session');
  await page.getByRole('button', { name: '清空当前对话' }).click();
  await page.getByRole('button', { name: '确认清空' }).click();
  await expect(page.locator('.exchange')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.exchange')).toHaveCount(0);
});
test('failed PDF, retry, API failure and unsafe Markdown have clear safe UI', async ({ page }) => {
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles(fixture('blank.pdf'));
  await expect(page.locator('.document-item').filter({ hasText: 'blank.pdf' })).toContainText('失败');
  await expect(page.locator('.document-item').filter({ hasText: 'blank.pdf' })).toContainText('OCR');
  const retried = page.waitForResponse(response => response.url().endsWith('/reindex') && response.request().method() === 'POST');
  await page.locator('.document-item').filter({ hasText: 'blank.pdf' }).getByRole('button', { name: '重试索引' }).click();
  await (await retried).finished();
  await expect(page.locator('.document-item').filter({ hasText: 'blank.pdf' })).toContainText('失败');
  await upload(page, 'orchid.pdf'); await page.getByRole('button', { name: '新建会话' }).click();
  await page.route('**/api/chat', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MODEL_FAILED', message: '模型服务调用失败，请重试。' } }) }));
  await ask(page, 'failure'); await expect(page.getByRole('alert').last()).toContainText('模型服务调用失败');
  await page.unroute('**/api/chat');
  const answer = '<script>window.compromised=true</script><img src=x onerror="window.compromised=true">\n\n**Safe** ![tracker](https://example.test/track) [link](javascript:alert(1))';
  await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: ' + JSON.stringify({ answer, supported: false, citations: [], retrieved: [] }) + '\n\n' }));
  await page.getByRole('button', { name: '按当前范围重试' }).last().click();
  await expect(page.locator('.answer strong')).toHaveText('Safe');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await expect(page.locator('.answer img,.answer script,.answer a')).toHaveCount(0);
});
