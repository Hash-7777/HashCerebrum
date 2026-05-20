// Left sidebar: a project selector over a saved-chats panel over the mode rail.

import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ModeRail } from './ModeRail';
import { ProjectSelector } from './ProjectSelector';

export function LeftRail() {
  return (
    <aside className="left-rail" aria-label="Sidebar">
      <ProjectSelector />
      <ChatHistoryPanel />
      <ModeRail />
    </aside>
  );
}
