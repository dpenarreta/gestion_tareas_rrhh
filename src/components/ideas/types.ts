export type IdeaImpact = "ALTO" | "MEDIO" | "BAJO";
export type IdeaStatus =
  | "PROPUESTA"
  | "EN_REVISION"
  | "APROBADA"
  | "EN_DESARROLLO"
  | "EN_PRUEBAS"
  | "IMPLEMENTADA"
  | "RECHAZADA";

export type IdeaAuthor = { id: string; name: string; role: string };

export type Idea = {
  id: string;
  title: string;
  description: string;
  impact: IdeaImpact;
  status: IdeaStatus;
  attachmentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  author: IdeaAuthor;
  latestRejectionComment?: string | null;
};

export type IdeaHistoryEntry = {
  id: string;
  fromStatus: IdeaStatus;
  toStatus: IdeaStatus;
  comment: string | null;
  createdAt: string;
  changer: IdeaAuthor;
};

export type IdeaDetail = Idea & { history: IdeaHistoryEntry[]; attachmentData: string | null };
