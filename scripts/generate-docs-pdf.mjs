#!/usr/bin/env node
/**
 * Generate PDF documentation from HTML sources.
 * Usage: node scripts/generate-docs-pdf.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const docsDir = path.join(root, 'docs');

const documents = [
  { html: 'business-overview.html', pdf: 'PhysioCare-Business-Overview.pdf' },
  { html: 'technical-documentation.html', pdf: 'PhysioCare-Technical-Documentation.pdf' },
];

async function generateWithPuppeteer() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const doc of documents) {
    const htmlPath = path.join(docsDir, doc.html);
    const pdfPath = path.join(docsDir, doc.pdf);
    const fileUrl = `file://${htmlPath}`;

    console.log(`Generating ${doc.pdf}…`);
    const page = await browser.newPage();
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await page.close();
    const size = fs.statSync(pdfPath).size;
    console.log(`  ✓ ${doc.pdf} (${(size / 1024).toFixed(0)} KB)`);
  }

  await browser.close();
}

async function main() {
  if (!fs.existsSync(docsDir)) {
    console.error('docs/ directory not found');
    process.exit(1);
  }

  await generateWithPuppeteer();
  console.log('\nDone! PDFs saved to docs/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
