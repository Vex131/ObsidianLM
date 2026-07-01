export interface AuthStatusResponse {
  configured: boolean;
  authRequired: boolean;
}

export interface AdminTokenRequest {
  token?: string;
}

export interface AuthSetupResponse {
  ok: true;
  configured: true;
}

export interface AuthVerifyResponse {
  ok: boolean;
}

export interface AuthLogoutResponse {
  ok: true;
}
