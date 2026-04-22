export interface ProofRequest {
  challengeId: string;
  model?: string;
}

export type ProofMode = 'stub' | 'byo-key' | 'local-oauth';

export interface ProofResponse {
  mode: ProofMode;
  endpoint: string;
  requestedModel: string;
  respondedModel: string | null;
  challengeId: string;
  sentAt: string;
  receivedAt: string | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  rawBody: string;
  streamedText: string;
  sseChunks: string[];
  parsedJson: unknown;
  upstreamStatus: number | null;
  note: string | null;
  error: string | null;
  bridge?: LocalBridgeDetails;
}

export interface LocalBridgeDetails {
  bridgePath: string;
  claudeVersion: string | null;
  authMethod: string | null;
  provider: string | null;
  exitCode: number | null;
  stderr: string;
  invokedWith: 'claude-cli' | 'bridge-script';
  sameMachineOnly: true;
  portable: false;
}

export type ActiveAuth = 'local-oauth' | 'byo-anthropic-key' | 'none';

export interface AuthReality {
  sanctionedThirdPartyOAuth: false;
  claudeMaxDirectLogin: 'not-available';
  localOauthBridge: {
    state: 'ready' | 'cli-missing' | 'cli-not-logged-in' | 'unknown';
    claudeBinaryDetected: boolean;
    claudeVersion: string | null;
    loggedIn: boolean;
    authMethod: string | null;
    provider: string | null;
    bridgePath: string | null;
    sameMachineOnly: true;
    portable: false;
    note: string;
  };
  activeAuth: ActiveAuth;
  honestSummary: string;
}

export type ProxyMode = 'stub' | 'byo-key' | 'local-oauth';

export interface StatusResponse {
  name: 'Maxbridge';
  version: string;
  endpoint: string;
  mode: ProxyMode;
  defaultModel: string;
  keySource: 'env' | 'none';
  telemetry: 'off';
  passthrough: {
    chatCompletions: '/v1/chat/completions';
    messages: '/v1/messages';
    proof: '/v1/proof';
    localBridge: '/v1/local-bridge';
  };
  limits: string[];
  authReality: AuthReality;
}
