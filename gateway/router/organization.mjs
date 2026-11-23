// Portable organization contract. No model calls or native writes belong here.
// The engine remains the single execution owner and enforces human grants.
export function validateOrganization(input, job) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.branches) || !input.branches.length || input.branches.length > 40) throw Error('Invalid organization');
  const ids = new Set();
  const branches = input.branches.map(b => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(b.id || '') || ids.has(b.id)) throw Error('Invalid or duplicate branch');
    ids.add(b.id);
    for (const field of ['role', 'goal', 'acceptance']) if (typeof b[field] !== 'string' || !b[field].trim() || b[field].length > 12000) throw Error('Invalid branch ' + field);
    if (!Array.isArray(b.dependsOn) || b.dependsOn.length > 40) throw Error('Invalid dependencies');
    if (!job.scope.includes(b.sessionKey)) throw Error('Worker outside project scope');
    if (!Array.isArray(b.requiredCapabilities) || b.requiredCapabilities.some(c => !['read','send','cancel','approve','answer'].includes(c))) throw Error('Invalid required capabilities');
    return {id:b.id, role:b.role, goal:b.goal, acceptance:b.acceptance, sessionKey:b.sessionKey,
      dependsOn:[...new Set(b.dependsOn)], requiredCapabilities:[...new Set(['send', ...b.requiredCapabilities])]};
  });
  const byId = new Map(branches.map(b => [b.id,b])), visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error('Dependency cycle');
    if (visited.has(id)) return;
    const b = byId.get(id); if (!b) throw Error('Unknown dependency');
    visiting.add(id); b.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  branches.forEach(b => visit(b.id));
  return {schemaVersion:1, branches};
}

export function organizationView(job, tasks, catalog) {
  const organization = job.organization;
  if (!organization) return {schemaVersion:1, revision:0, branches:[]};
  const nodes = new Map(catalog.sessions.map(s => [s.key,s]));
  const latest = new Map();
  for (const b of organization.branches) {
    const matches = tasks.filter(t => t.package?.organizationBranch === b.id && !t.supersededBy)
      .sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (matches.length) latest.set(b.id,matches[0]);
  }
  return {...organization, branches:organization.branches.map(b => {
    const task = latest.get(b.id), node = nodes.get(b.sessionKey), blockers = [];
    if (job.paused) blockers.push('project_paused');
    if (!node || node.mode !== 'original-live') blockers.push('worker_unavailable');
    for (const c of b.requiredCapabilities) if (node?.capabilities?.[c] !== 'supported') blockers.push('unsupported:' + c);
    if (!job.execution?.sessions?.includes(b.sessionKey)) blockers.push('execution_grant_required');
    for (const dep of b.dependsOn) if (latest.get(dep)?.state !== 'succeeded') blockers.push('dependency_unaccepted:' + dep);
    if (tasks.some(t => t.session === b.sessionKey && !['succeeded','failed','cancelled','superseded'].includes(t.state))) blockers.push('worker_occupied');
    return {...b, taskId:task?.id || null, taskState:task?.state || null,
      ready:!task && blockers.length === 0, blockers,
      evidence:task?.observed?.evidenceRefs || []};
  })};
}
