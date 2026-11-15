// Texterkennung mit der in macOS eingebauten Vision-Bibliothek. Läuft offline.
// Aufruf: osascript -l JavaScript ocr.js <Bilddatei>
// Ausgabe: JSON-Liste mit y (oben 0), x (links 0) und Zeilenhöhe h in Tausendstel der Bildgröße und dem erkannten Text.
ObjC.import('Vision');

function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0;  // genau statt schnell
  request.recognitionLanguages = $(['de-DE']);
  request.usesLanguageCorrection = false;  // Zahlen nicht "verbessern"
  const error = Ref();
  if (!handler.performRequestsError($([request]), error)) {
    throw new Error('Texterkennung fehlgeschlagen');
  }
  const lines = [];
  const results = request.results;
  for (let i = 0; i < results.count; i++) {
    const item = results.objectAtIndex(i);
    const box = item.boundingBox;
    lines.push({
      y: Math.round((1 - box.origin.y - box.size.height) * 1000),
      x: Math.round(box.origin.x * 1000),
      h: Math.round(box.size.height * 1000),
      text: item.topCandidates(1).objectAtIndex(0).string.js,
    });
  }
  return JSON.stringify(lines);
}
