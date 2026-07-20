// Backlog item 35: a small fixed picker categorizing what kind of group each one is.
// Shared here so Groups.tsx (filter) and GroupDetail.tsx (the picker itself) can't drift apart.
export const GROUP_TYPES = ['Family', 'Friend group', 'School', 'Team', 'Work'] as const

export type GroupType = (typeof GROUP_TYPES)[number]
