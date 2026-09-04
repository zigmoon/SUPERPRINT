const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const JSZip = require('../../JS/jszip.min.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'styled-reflow');
const appUrl = 'file:///' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');

async function buildFixture() {
  const zip = new JSZip();
  const files = [
    'designmap.xml',
    'Resources/Preferences.xml',
    'Spreads/Spread_u1.xml',
    'Stories/Story_story-main.xml'
  ];
  files.forEach((file) => zip.file(file, fs.readFileSync(path.join(fixtureRoot, file), 'utf8')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('imports a styled IDML story across linked frames without duplication', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.addInitScript(() => localStorage.clear());
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Skip' }).click().catch(() => {});
  await page.locator('#openImportModal').click();
  await page.locator('#importIdmlBtn').click();
  await page.locator('#idmlZipFileInput').setInputFiles({
    name: 'styled-reflow.idml',
    mimeType: 'application/vnd.adobe.indesign-idml-package',
    buffer: await buildFixture()
  });
  await page.waitForFunction(() => {
    const objects = JSON.parse(pages[0].objects).objects.filter((object) => object.type === 'textbox');
    return objects.length === 2 && Object.keys(textLinks).length === 1;
  });

  const result = await page.evaluate(() => {
    const objects = JSON.parse(pages[0].objects).objects.filter((object) => object.type === 'textbox');
    return {
      objects,
      links: textLinks,
      combinedText: objects.map((object) => object.text).join('')
    };
  });

  expect(result.objects).toHaveLength(2);
  expect(result.objects[0].text).not.toBe(result.objects[1].text);
  expect(Object.keys(result.links)).toHaveLength(1);
  expect(result.combinedText).toContain('Titre italique');
  expect(result.objects[0].fontWeight).toBe('bold');
  expect(result.objects[0].styles[0][6]).toMatchObject({ fontSize: 12, fontWeight: 'normal', fontStyle: 'italic', underline: true });
});