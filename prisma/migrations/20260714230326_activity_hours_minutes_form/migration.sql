-- Nuevo formulario de actividad (Horas/Minutos) reemplaza hora inicio/fin.
-- startTime/endTime pasan a opcionales: las actividades nuevas ya no los
-- registran (se calcula duration directamente), pero se conservan en las
-- actividades históricas existentes.
ALTER TABLE "TaskActivity" ALTER COLUMN "startTime" DROP NOT NULL;
ALTER TABLE "TaskActivity" ALTER COLUMN "endTime" DROP NOT NULL;
