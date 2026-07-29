import { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { Button } from './Button.jsx';

/**
 * DropZone — shared local-first lab-file intake. Reads a dropped/selected text export
 * (.csv/.tsv/.txt) IN THE BROWSER via FileReader and hands the raw text up via onText.
 * It never uploads the file anywhere — the parent decides what to do with the text (the
 * Nutrition + Lab Results pages POST it to the same /nutrition/parse endpoint). No photos,
 * no PDFs, no third-party OCR — text only, by design.
 */
const ACCEPT = '.csv,.tsv,.txt,.tab,text/csv,text/tab-separated-values,text/plain';

export function DropZone({ onText, onError, fileName, busy, compact = false }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  function handleFile(file) {
    if (!file) return;
    const okType = /\.(csv|tsv|txt|tab)$/i.test(file.name) || /text\//.test(file.type) || file.type === '';
    if (!okType) {
      onError?.(new Error('Please use a .csv, .tsv, or .txt lab export (text only — no photos or PDFs).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result || ''), file.name);
    reader.onerror = () => onError?.(new Error('Could not read that file.'));
    reader.readAsText(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files?.[0]); }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors ${
        compact ? 'px-3 py-4' : 'px-4 py-7'
      } ${over ? 'border-primary bg-accent-soft' : 'border-border bg-muted/30'}`}
    >
      {!compact && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-primary">
          <UploadCloud className="h-5 w-5" />
        </div>
      )}
      <div className={compact ? 'text-2xs font-medium text-foreground' : 'text-sm font-medium text-foreground'}>
        {compact ? 'Drag & drop a lab export' : 'Drag & drop a lab export here'}
      </div>
      {!compact && (
        <div className="text-2xs text-faint">CSV, TSV, or plain text — or paste below. Read in your browser, never sent to a third party.</div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          <FileText className="h-3.5 w-3.5" /> Choose file
        </Button>
        {fileName && (
          <span className="inline-flex items-center gap-1 font-data text-2xs text-soft">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {fileName}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

export default DropZone;
