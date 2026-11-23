import crypto from 'node:crypto';

export const routerObservations=new Set(['catalog','snapshot','events','read_session','read_resource','reconcile','briefing','organization']);
const operations=new Set([...routerObservations,'prepare_tool','save_organization','ack_briefing','create_session','wake','create_job','assign','revise_task','dispatch','pause','resume','cancel','answer','accept']);
export function normalizeRouterCall(input){
  if(!input||!operations.has(input.operation))throw Error('Unsupported Router operation');
  if(input.args!==undefined&&(!input.args||typeof input.args!=='object'||Array.isArray(input.args)))throw Error('Router args must be an object');
  if(!routerObservations.has(input.operation)&&!input.requestId)throw Error('Native write requires a stable requestId. Inspect state before retrying an uncertain write.');
  const requestId=input.requestId||crypto.randomUUID();
  if(typeof requestId!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(requestId))throw Error('Invalid Router requestId');
  // Observation keys are transport envelopes only: reconcile may update facts
  // but can never submit a prompt, cancel or answer a native interaction.
  return {operation:input.operation,args:input.args||{},requestId};
}
