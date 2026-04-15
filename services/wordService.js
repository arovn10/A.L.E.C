// services/wordService.js
'use strict';

const path = require('path');
const fs = require('fs');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType } = require('docx');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

/**
 * Generate a Word document with property heading and T12 table.
 * @param {{ property: string, t12Data: Array<{ month: string, grossIncome: number, expenses: number, noi: number }> }} options
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function generate({ property, t12Data = [] }) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const fileName = `t12_${timestamp()}.docx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  // Build table rows
  const headerRow = new TableRow({
    children: [
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Month', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Gross Income', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Expenses', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'NOI', bold: true })] })] }),
    ],
  });

  const dataRows = (t12Data || []).map(
    (row) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(row.month || '')] }),
          new TableCell({ children: [new Paragraph(`$${(row.grossIncome || 0).toLocaleString()}`)] }),
          new TableCell({ children: [new Paragraph(`$${(row.expenses || 0).toLocaleString()}`)] }),
          new TableCell({ children: [new Paragraph(`$${(row.noi || 0).toLocaleString()}`)] }),
        ],
      })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: `T12 Summary — ${property}`,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `Generated: ${new Date().toLocaleDateString()}`,
            alignment: AlignmentType.RIGHT,
          }),
          new Paragraph({ text: '' }), // spacer
          table,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  return { filePath, fileName };
}

module.exports = { generate };
