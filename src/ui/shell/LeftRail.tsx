// Left sidebar: an upper saved-chats panel over a lower mode rail.

import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ModeRail } from './ModeRail';

export function LeftRail() {
  return (
    <aside className="left-rail" aria-label="Sidebar">
      <ChatHistoryPanel />
      <ModeRail />
    </aside>
  );
}
