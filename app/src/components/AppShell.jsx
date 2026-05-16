import { GitBranch, GitPullRequest, KeyRound, MessageSquare, Network, ShieldCheck, Split, Users } from 'lucide-react';

export function Sidebar({ project, activeView, onViewChange }) {
  const items = [
    ['platform', 'Platform', ShieldCheck],
    ['project', '项目', GitBranch],
    ['chat', 'Chat', MessageSquare],
    ['work', 'Work', GitPullRequest],
    ['team', 'Team', Users],
    ['sessions', 'Sessions', Split],
    ['api', 'API', Network],
    ['settings', 'Settings', KeyRound]
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">AT</div>
        <div>
          <strong>AT 群聊</strong>
          <span>AI 合作群聊</span>
        </div>
      </div>
      <nav>
        {items.map(([id, label, Icon]) => (
          <button
            className={activeView === id ? 'nav-item active' : 'nav-item'}
            key={id}
            onClick={() => onViewChange(id)}
            type="button"
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      <div className="project-card">
        <span>当前项目</span>
        <strong>{project?.name || 'AT Group Chat'}</strong>
        <small>{project?.path || '/Users/felix/Desktop/AT Group Chat'}</small>
      </div>
    </aside>
  );
}
