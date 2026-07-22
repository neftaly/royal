/** Pure interpretation of the public XR lifecycle observed by the device harness. */
export const classifyXrActivation = ({
  instrumented,
  showsExit,
  status,
  statusText,
}) => {
  if (instrumented && (status === 'active' || showsExit)) {
    return { kind: 'active', status: status ?? 'immersive' };
  }
  if (typeof statusText === 'string' && /already an active, immersive XRSession/iu.test(statusText)) {
    return {
      kind: 'failure',
      reason: 'immersive-session-already-active',
      status: statusText,
    };
  }
  switch (status) {
    case undefined:
    case null:
    case 'checking':
    case 'available':
    case 'starting':
    case 'active':
    case 'suspended':
    case 'ending':
      return { kind: 'pending' };
    default:
      return { kind: 'failure', reason: 'xr-status-error', status: statusText ?? status };
  }
};
