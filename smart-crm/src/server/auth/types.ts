export type SessionUser = {
  userId: string;
  email: string;
  emailVerified: boolean;
  /** aal2 once the user has passed a second factor in this session. */
  aal: "aal1" | "aal2";
  /** The user has at least one verified MFA factor (so aal2 is required). */
  mfaEnrolled: boolean;
  sessionId: string | null;
};

export type SignInResult =
  | { status: "ok" }
  | { status: "mfa_required" }
  | { status: "email_not_verified" }
  | { status: "invalid_credentials" };

export type MfaFactor = { id: string; status: "verified" | "unverified"; createdAt: Date | null };

export type SessionInfo = {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
};

export type RequestInfo = { ip: string | null; userAgent: string | null };

export interface AuthAdapter {
  readonly kind: "local" | "supabase";
  getSessionUser(): Promise<SessionUser | null>;
  signUp(input: { email: string; password: string; fullName: string; locale: "he" | "en" }, req: RequestInfo): Promise<void>;
  signIn(input: { email: string; password: string }, req: RequestInfo): Promise<SignInResult>;
  signOut(scope: "local" | "others" | "global"): Promise<void>;
  resendVerification(email: string): Promise<void>;
  /** Confirms an email-verification or recovery link. */
  confirm(input: { token: string; type: "email" | "recovery" }): Promise<{ userId: string } | null>;
  requestPasswordReset(email: string): Promise<void>;
  /** Local: needs the token from the email. Supabase: needs the recovery session. */
  completePasswordReset(input: { token?: string; password: string }): Promise<boolean>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<boolean>;
  mfaEnroll(): Promise<{ factorId: string; secret: string; uri: string }>;
  mfaVerifyEnrollment(input: { factorId: string; code: string }): Promise<boolean>;
  mfaChallenge(code: string): Promise<boolean>;
  mfaUnenroll(factorId: string): Promise<boolean>;
  mfaFactors(): Promise<MfaFactor[]>;
  /** null when the provider cannot list sessions. */
  listSessions(): Promise<SessionInfo[] | null>;
  revokeSession(sessionId: string): Promise<void>;
}
