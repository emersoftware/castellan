// The web app's modules read Vite's import.meta.env (only inside functions the video never calls).
interface ImportMeta { readonly env: Record<string, string | undefined> }
declare module "*.css";
