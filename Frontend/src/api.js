const rawUrl = (import.meta.env.VITE_API_URL || "http://localhost:5000").trim();
export const VITE_API_URL = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;