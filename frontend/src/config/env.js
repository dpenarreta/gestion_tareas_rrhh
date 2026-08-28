const REQUIRED_VARS = ["VITE_API_BASE_URL"];

function validateRequiredEnv() {
  const missing = REQUIRED_VARS.filter((name) => !import.meta.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `No se puede iniciar la aplicación: faltan variables de entorno obligatorias: ${missing.join(", ")}. ` +
        "Defina estos valores en su archivo .env (ver .env.example) antes de continuar."
    );
  }
}

validateRequiredEnv();

export const env = {
  appName: import.meta.env.VITE_APP_NAME || "Nexo",
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
};
