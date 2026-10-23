/** Synthetic workflows are available in development, or on an explicitly opted-in demo deployment. */
export const DEMO_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true';
