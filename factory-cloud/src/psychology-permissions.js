// Module eligibility is not a grant: members receive only the saved checkboxes.
export function hasPsychologyModule(user, ...modules) {
  return Boolean(user && ['admin', 'operator'].includes(user.role)
    && user.active !== false && user.active !== 0
    && modules.some(id => user.sidebarModules?.includes(id)));
}
