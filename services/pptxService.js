// services/pptxService.js
'use strict';

const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

/**
 * Generate a PowerPoint deck with a title slide and one slide per property.
 * @param {{ title: string, properties: Array<{ name: string, balance: number, ltv: number, dscr: number }> }} options
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function generate({ title, properties = [] }) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const fileName = `deck_${timestamp()}.pptx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(title, {
    x: '10%',
    y: '35%',
    w: '80%',
    h: '30%',
    fontSize: 36,
    bold: true,
    align: 'center',
    color: '003366',
  });
  titleSlide.addText(`Generated: ${new Date().toLocaleDateString()}`, {
    x: '10%',
    y: '65%',
    w: '80%',
    h: '10%',
    fontSize: 16,
    align: 'center',
    color: '666666',
  });

  // One slide per property
  for (const prop of properties) {
    const slide = pptx.addSlide();

    slide.addText(prop.name, {
      x: '5%',
      y: '5%',
      w: '90%',
      h: '15%',
      fontSize: 28,
      bold: true,
      color: '003366',
    });

    const bullets = [
      { text: `Current Balance: $${(prop.balance || 0).toLocaleString()}`, options: { fontSize: 18, bullet: true } },
      { text: `LTV: ${prop.ltv || 'N/A'}%`, options: { fontSize: 18, bullet: true } },
      { text: `DSCR: ${prop.dscr || 'N/A'}`, options: { fontSize: 18, bullet: true } },
    ];

    slide.addText(bullets, {
      x: '5%',
      y: '25%',
      w: '90%',
      h: '60%',
    });
  }

  await pptx.writeFile({ fileName: filePath });
  return { filePath, fileName };
}

module.exports = { generate };
