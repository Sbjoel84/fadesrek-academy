'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Every export starts from the same shape: `columns` is
// [{ key, label }, ...] and `rows` is an array of plain objects keyed by
// `key`. One shape, three renderers — the report routes build this once and
// never know which format the client asked for.

function cell(row, col) {
  const v = row[col.key];
  return v === null || v === undefined ? '' : v;
}

function toCsv(columns, rows) {
  const escapeCsv = v => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escapeCsv(c.label)).join(',');
  const lines = rows.map(row => columns.map(c => escapeCsv(cell(row, c))).join(','));
  return [header, ...lines].join('\r\n');
}

async function toXlsx(title, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel's own sheet-name length limit
  sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(columns.reduce((acc, c) => ({ ...acc, [c.key]: cell(row, c) }), {}));
  return workbook.xlsx.writeBuffer();
}

/** No table primitive in pdfkit — this hand-rolls fixed-width columns and a
 * new page when a row would run off the bottom. Good enough for a report
 * table; not a general-purpose PDF layout engine. */
function toPdfTable(title, columns, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 18;
    const bottom = doc.page.height - doc.page.margins.bottom;

    doc.fontSize(16).text(title, { align: 'left' });
    doc.moveDown(0.5);

    const drawHeader = () => {
      const y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      columns.forEach((c, i) => doc.text(c.label, doc.page.margins.left + i * colWidth, y, { width: colWidth - 4 }));
      doc.font('Helvetica');
      doc.moveDown(1);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.3);
    };

    drawHeader();
    for (const row of rows) {
      if (doc.y + rowHeight > bottom) { doc.addPage(); drawHeader(); }
      const y = doc.y;
      doc.fontSize(8.5);
      columns.forEach((c, i) => doc.text(String(cell(row, c)), doc.page.margins.left + i * colWidth, y, { width: colWidth - 4 }));
      doc.moveDown(0.9);
    }
    doc.end();
  });
}

module.exports = { toCsv, toXlsx, toPdfTable };
