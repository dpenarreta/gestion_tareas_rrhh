const raw = process.env.SESSION_SECRET;

if (!raw || raw.length < 32) {
  throw new Error(
    "SESSION_SECRET no está configurado o es demasiado corto (mínimo 32 caracteres). " +
      "Defínelo en las variables de entorno antes de iniciar la aplicación."
  );
}

export const SESSION_SECRET = raw;
