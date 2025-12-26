'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 bg-fd-muted p-2 pl-5 rounded-lg font-mono text-sm border border-fd-border text-fd-foreground/80 group">
      <code className="flex-1 text-left">{command}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={copy}
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
