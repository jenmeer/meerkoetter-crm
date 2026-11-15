// Liest den Text einer PDF mit der in macOS eingebauten PDFKit-Bibliothek. Läuft offline.
// Aufruf: osascript -l JavaScript pdftext.js <PDF-Datei>
// Ausgabe: JSON mit der Seitenzahl und dem Text aller Seiten. Eingescannte PDFs liefern keinen Text.
ObjC.import('PDFKit');

function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) throw new Error('Keine lesbare PDF');
  const pages = [];
  const count = Math.min(doc.pageCount, 60);
  for (let i = 0; i < count; i++) {
    const text = doc.pageAtIndex(i).string;
    pages.push(text && !text.isNil() ? text.js : '');
  }
  return JSON.stringify({ pages: doc.pageCount, text: pages.join('\n') });
}
