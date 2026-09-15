// The fact-check that runs after a research answer settles. Kept beside the
// workspace that owns the transcript, which it annotates through setMessages.

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useMemorySettingsStore } from '@core/store/memorySettingsStore';
import type { ChatMessage } from './components/Transcript';
import { verifyAnswer } from './swarm/claimVerify';

export function useAnswerVerification(
  messages: ChatMessage[],
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): void {
  // Fact-check finalized research answers once each: the offline NLI model checks
  // whether every cited sentence is entailed by its source, and any that are not
  // are attached to the message for a subtle "may not be fully supported" note.
  // Path-agnostic (covers every finalize path), gated by the verify setting, and
  // fail-open — it only annotates, never rewrites, and a no-op when the model is
  // absent. The ref guard stops it re-running as the message list re-renders.
  const verifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!useMemorySettingsStore.getState().verifyEnabled) return;
    const target = messages.find(
      (m) =>
        m.role === 'assistant' &&
        !m.isStreaming &&
        (m.citations?.length ?? 0) > 0 &&
        !verifiedRef.current.has(m.id),
    );
    if (!target) return;
    verifiedRef.current.add(target.id);
    let cancelled = false;
    void verifyAnswer(target.content, target.citations ?? []).then((res) => {
      // Record the result whenever the model actually checked something — even
      // when nothing is unsupported — so the positive "% of claims verified"
      // trust badge can render, not only the warning. A no-op run (no model, or
      // no cited sentences) leaves the message untouched.
      if (cancelled || res.checked === 0) return;
      setMessages((current) =>
        current.map((m) =>
          m.id === target.id
            ? {
                ...m,
                verification: { checked: res.checked, supported: res.checked - res.unsupported.length },
                ...(res.unsupported.length > 0 ? { unsupportedClaims: res.unsupported } : {}),
              }
            : m,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [messages]);
}
