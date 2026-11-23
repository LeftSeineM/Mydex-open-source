import crypto from 'node:crypto';

// A purpose-bound credential for the local MCP transport. Never expose the
// phone/owner credential to the model, or infer authority from request JSON.
export function coordinatorToken(ownerToken) {
  return crypto.createHmac('sha256', ownerToken)
    .update('Mydex/native-router/coordinator/v1').digest('hex');
}
