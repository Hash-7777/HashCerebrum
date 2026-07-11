import { beforeEach, describe, expect, it } from 'vitest';
import { PENDING_KEY, useChatTraceStore } from '../chatTraceStore';

beforeEach(() => {
  useChatTraceStore.setState({ byChat: {}, activeKey: PENDING_KEY, hydrated: true });
});

describe('chatTraceStore', () => {
  it('records newest-first under the active chat', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    store.add({ agentId: 'boss', phase: 'start', detail: 'first' });
    store.add({ agentId: 'evidence_synthesis', phase: 'tool_call', detail: 'second' });
    const entries = useChatTraceStore.getState().byChat['chat-a'] ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.detail).toBe('second');
    expect(entries[1]?.detail).toBe('first');
  });

  it('keeps each chat trace separate', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    store.add({ agentId: 'boss', phase: 'start', detail: 'a' });
    store.setActiveKey('chat-b');
    store.add({ agentId: 'boss', phase: 'start', detail: 'b' });
    const { byChat } = useChatTraceStore.getState();
    expect(byChat['chat-a']).toHaveLength(1);
    expect(byChat['chat-b']).toHaveLength(1);
    expect(byChat['chat-a']?.[0]?.detail).toBe('a');
    expect(byChat['chat-b']?.[0]?.detail).toBe('b');
  });

  it('marks a prompt divider for a sent message', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    store.markPrompt('  compare  PCSK9   and APOB  ');
    const entry = useChatTraceStore.getState().byChat['chat-a']?.[0];
    expect(entry?.kind).toBe('prompt');
    expect(entry?.detail).toBe('compare PCSK9 and APOB');
  });

  it('adopts a pending run into the real chat id, oldest of the run first', () => {
    const store = useChatTraceStore.getState();
    // A fresh chat runs before it has an id.
    store.setActiveKey(PENDING_KEY);
    store.markPrompt('question');
    store.add({ agentId: 'boss', phase: 'done', detail: 'answer' });
    // The turn is saved and the chat gets an id.
    store.adoptPending('chat-real');
    const { byChat } = useChatTraceStore.getState();
    expect(byChat[PENDING_KEY]).toBeUndefined();
    const entries = byChat['chat-real'] ?? [];
    expect(entries).toHaveLength(2);
    // Still newest-first: the answer precedes the prompt.
    expect(entries[0]?.detail).toBe('answer');
    expect(entries[1]?.kind).toBe('prompt');
  });

  it('clears only the active chat', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    store.add({ agentId: 'boss', phase: 'start', detail: 'a' });
    store.setActiveKey('chat-b');
    store.add({ agentId: 'boss', phase: 'start', detail: 'b' });
    store.clearActive(); // active is chat-b
    const { byChat } = useChatTraceStore.getState();
    expect(byChat['chat-b']).toBeUndefined();
    expect(byChat['chat-a']).toHaveLength(1);
  });

  it('drops traces for chats that no longer exist', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    store.add({ agentId: 'boss', phase: 'start', detail: 'a' });
    store.setActiveKey('chat-b');
    store.add({ agentId: 'boss', phase: 'start', detail: 'b' });
    store.retainChats(new Set(['chat-a']));
    const { byChat } = useChatTraceStore.getState();
    expect(byChat['chat-a']).toHaveLength(1);
    expect(byChat['chat-b']).toBeUndefined();
  });

  it('caps a chat trace so it cannot grow unbounded', () => {
    const store = useChatTraceStore.getState();
    store.setActiveKey('chat-a');
    for (let i = 0; i < 650; i++) store.add({ agentId: 'boss', phase: 'token', detail: `e${i}` });
    const entries = useChatTraceStore.getState().byChat['chat-a'] ?? [];
    expect(entries).toHaveLength(600);
    expect(entries[0]?.detail).toBe('e649');
  });
});
