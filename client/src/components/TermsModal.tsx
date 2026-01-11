import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  footerMeta?: string;
  onScrolledToEnd: () => void;
}

export function TermsModal({
  open,
  onClose,
  title,
  text,
  footerMeta,
  onScrolledToEnd,
}: TermsModalProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);

  useEffect(() => {
    if (!open) {
      setHasReachedEnd(false);
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [open, text]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || hasReachedEnd) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (atBottom) {
      setHasReachedEnd(true);
      onScrolledToEnd();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[420px] overflow-auto border rounded-md p-4 whitespace-pre-wrap text-sm leading-relaxed bg-muted/30"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
          >
            {text || "No terms loaded."}
          </div>
          
          {!hasReachedEnd && text && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none flex items-end justify-center pb-2">
              <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                Scroll down to continue
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-3 mt-3">
          <div className="flex-1 min-w-0 text-xs text-muted-foreground flex items-start sm:items-center gap-2 flex-wrap">
            {hasReachedEnd && (
              <span className="flex items-center gap-1 text-green-600 shrink-0">
                <CheckCircle className="h-3 w-3" />
                Read
              </span>
            )}
            {footerMeta && (
              <span className="break-all select-all">{footerMeta}</span>
            )}
          </div>
          <Button onClick={onClose} className="shrink-0 min-h-[44px] w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
