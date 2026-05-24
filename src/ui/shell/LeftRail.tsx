import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ModeRail } from './ModeRail';
import { ProjectSelector } from './ProjectSelector';

export function LeftRail() {
  return (
    <aside className="left-rail" aria-label="Sidebar">
      <div className="side">
        <ProjectSelector />
        <ChatHistoryPanel />
        <ModeRail />
      </div>
    </aside>
  );
}
