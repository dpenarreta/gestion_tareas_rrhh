import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await bcrypt.hash("123456", 10);

  const administrador = await prisma.user.upsert({
    where: { email: "administrador@nexo.com" },
    update: {},
    create: {
      email: "administrador@nexo.com",
      name: "Administrador",
      password,
      role: "ADMINISTRADOR",
    },
  });

  const jefe = await prisma.user.upsert({
    where: { email: "jefe@nexo.com" },
    update: {},
    create: {
      email: "jefe@nexo.com",
      name: "Jefe Nacional",
      password,
      role: "JEFE_NACIONAL",
    },
  });

  const coordNacional = await prisma.user.upsert({
    where: { email: "coord.nacional@nexo.com" },
    update: {},
    create: {
      email: "coord.nacional@nexo.com",
      name: "Coordinador Nacional",
      password,
      role: "COORDINADOR_NACIONAL",
    },
  });

  const prueba = await prisma.user.upsert({
    where: { email: "prueba@nexo.com" },
    update: {},
    create: {
      email: "prueba@nexo.com",
      name: "Usuario Prueba",
      password,
      role: "COORDINADOR_NACIONAL",
    },
  });

  console.log("Seed completado:");
  console.log(`  Administrador:        ${administrador.email} / 123456`);
  console.log(`  Jefe Nacional:        ${jefe.email} / 123456`);
  console.log(`  Coordinador Nacional: ${coordNacional.email} / 123456`);
  console.log(`  Usuario Prueba:       ${prueba.email} / 123456`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
