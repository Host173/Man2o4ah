export function validate(config: Record<string, unknown>) {
  if (!config.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env (see .env.example).',
    );
  }
  return config;
}
