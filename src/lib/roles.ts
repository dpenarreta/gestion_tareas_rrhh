import type { Role } from "@/generated/prisma/client";

export const ROLE_LEVEL: Record<Role, number> = {
  ADMINISTRADOR: 5,
  JEFE_NACIONAL: 4,
  COORDINADOR_NACIONAL: 3,
  COORDINADOR_ZS: 2,
  ANALISTA_CC: 2,
  ANALISTA_SELECCION: 2,
  ASISTENTE_SELECCION: 1,
  ASISTENTE_GH: 1,
  ASISTENTE_GH_ZS: 1,
  TRABAJO_SOCIAL: 1,
  ASISTENTE_NOMINA: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMINISTRADOR: "Administrador",
  JEFE_NACIONAL: "Jefe Nacional",
  COORDINADOR_NACIONAL: "Coordinador Nacional",
  COORDINADOR_ZS: "Coordinador ZS",
  ANALISTA_CC: "Analista Clima y Cultura",
  ANALISTA_SELECCION: "Analista Selección de Personal",
  ASISTENTE_SELECCION: "Asistente de Selección",
  ASISTENTE_GH: "Asistente de Gestión Humana",
  ASISTENTE_GH_ZS: "Asistente GH ZS",
  TRABAJO_SOCIAL: "Trabajo Social",
  ASISTENTE_NOMINA: "Asistente de Nómina",
};

// Roles whose tasks each role can see
export const VISIBLE_ROLES: Record<Role, Role[]> = {
  ADMINISTRADOR: [
    "ADMINISTRADOR",
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
  ],
  JEFE_NACIONAL: [
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
  ],
  COORDINADOR_NACIONAL: [
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
  ],
  COORDINADOR_ZS: ["COORDINADOR_ZS", "ASISTENTE_GH_ZS"],
  ANALISTA_CC: ["ANALISTA_CC", "ASISTENTE_GH", "TRABAJO_SOCIAL"],
  ANALISTA_SELECCION: [
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "TRABAJO_SOCIAL",
  ],
  ASISTENTE_SELECCION: ["ASISTENTE_SELECCION"],
  ASISTENTE_GH: ["ASISTENTE_GH"],
  ASISTENTE_GH_ZS: ["ASISTENTE_GH_ZS"],
  TRABAJO_SOCIAL: ["TRABAJO_SOCIAL"],
  ASISTENTE_NOMINA: ["ASISTENTE_NOMINA"],
};

// Who gets notified (upward) when a task comment is made
export const NOTIFICATION_TARGETS: Record<Role, Role[]> = {
  ADMINISTRADOR: [],
  JEFE_NACIONAL: [],
  COORDINADOR_NACIONAL: ["JEFE_NACIONAL"],
  COORDINADOR_ZS: ["COORDINADOR_NACIONAL"],
  ANALISTA_CC: ["COORDINADOR_NACIONAL"],
  ANALISTA_SELECCION: ["COORDINADOR_NACIONAL"],
  ASISTENTE_SELECCION: ["ANALISTA_SELECCION"],
  ASISTENTE_GH: ["ANALISTA_CC", "ANALISTA_SELECCION"],
  ASISTENTE_GH_ZS: ["COORDINADOR_ZS"],
  TRABAJO_SOCIAL: ["ANALISTA_CC", "ANALISTA_SELECCION"],
  ASISTENTE_NOMINA: ["COORDINADOR_NACIONAL", "JEFE_NACIONAL"],
};

export const CAN_CREATE_MEETINGS: Role[] = [
  "ADMINISTRADOR",
  "JEFE_NACIONAL",
  "COORDINADOR_NACIONAL",
  "COORDINADOR_ZS",
];

export const CAN_MANAGE_USERS: Role[] = [
  "ADMINISTRADOR",
  "JEFE_NACIONAL",
  "COORDINADOR_NACIONAL",
];

export function canManageUsers(role: Role): boolean {
  return CAN_MANAGE_USERS.includes(role);
}

export function canCreateMeetings(role: Role): boolean {
  return CAN_CREATE_MEETINGS.includes(role);
}

export function getVisibleRoles(role: Role): Role[] {
  return VISIBLE_ROLES[role];
}

export function getNotificationTargets(role: Role): Role[] {
  return NOTIFICATION_TARGETS[role];
}

export function getSubordinateRoles(role: Role): Role[] {
  return VISIBLE_ROLES[role].filter((r) => r !== role);
}

export function canViewTeam(role: Role): boolean {
  return ROLE_LEVEL[role] >= 2;
}

export const CAN_ACCESS_REPORTS: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

export function canAccessReports(role: Role): boolean {
  return CAN_ACCESS_REPORTS.includes(role);
}

export const CAN_REVIEW_IDEAS: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"];

export function canReviewIdeas(role: Role): boolean {
  return CAN_REVIEW_IDEAS.includes(role);
}

export const CAN_MANAGE_KNOWLEDGE_BASE: Role[] = ["ADMINISTRADOR", "COORDINADOR_NACIONAL"];

export function canManageKnowledgeBase(role: Role): boolean {
  return CAN_MANAGE_KNOWLEDGE_BASE.includes(role);
}

export const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[];
