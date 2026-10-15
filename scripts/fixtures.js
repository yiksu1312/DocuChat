import PDFDocument from 'pdfkit';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function makePDF(text) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ compress: false }), chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [i, page] of (Array.isArray(text) ? text : [text]).entries()) { if (i) doc.addPage(); if (page) doc.fontSize(16).text(page, 60, 70); }
    doc.end();
  });
}
export async function fixtures() {
  const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/orchid.pdf`, await makePDF('The fictional Orchid project launch code is ORCHID-742. Its storage capacity is 37 liters. The project lead is Mira.'));
  await writeFile(`${dir}/cedar.pdf`, await makePDF('The fictional Cedar project launch code is CEDAR-219. Its storage capacity is 83 liters. The project lead is Noah.'));
  await writeFile(`${dir}/blank.pdf`, await makePDF(''));
  await writeFile(`${dir}/invalid.txt`, 'This is not a PDF.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await fixtures(); console.log('Non-private PDF fixtures created.'); }
