// Public API re-exports for the Maxbridge license module.
//
// Callers should import from `./license` rather than reaching into individual
// files, so the internal layout stays changeable.

export {
  readLicense,
  writeLicense,
  deleteLicense,
  licenseFilePath,
  type LicenseState,
  type LicenseType,
  type LicensePlan,
  type ValidationStatus,
} from './store.js';

export { verifyLifetimeJwt, type JwtVerification } from './jwt.js';

export { decide, type GateDecision } from './gate.js';

export {
  validateOnline,
  startTrial,
  type ValidateResult,
  type StartTrialResult,
} from './client.js';

export { ensureFriendTrialLicense } from './auto-trial.js';

export { startOnlineLicensePoller, applyOnlineResult } from './online-poller.js';

export {
  tryHandleLicenseRoute,
  handleLicenseStatus,
  handleStartTrial,
  handleActivate,
  handleDeactivate,
} from './routes.js';
