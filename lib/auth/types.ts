export type AuthProvider = 'anonymous';

export type AuthUser = {
  id: string;
  displayName: string;
  provider: AuthProvider;
};
