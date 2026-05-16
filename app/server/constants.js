export const MANAGER_ROLE_ID = 'codex-manager';
export const GOAL_REVIEW_ROLE_ID = 'codex-goal-review';

export const DEFAULT_CHAT_PROMPT = '请作为 team manager，阅读当前 AT 群聊和 Work Board，判断下一步应该由谁处理。';

export const MAX_TEXT_FIELD_LENGTH = Number(process.env.AT_TEAM_MAX_TEXT_FIELD_LENGTH || 32_000);
