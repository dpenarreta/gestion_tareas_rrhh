import { describe, expect, it, vi, beforeEach } from "vitest";

const commentFindMany = vi.fn();
const viewFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: { findMany: commentFindMany },
    taskCommentView: { findMany: viewFindMany },
  },
}));

const { attachUnreadComments } = await import("@/lib/commentViews");

describe("attachUnreadComments", () => {
  beforeEach(() => {
    commentFindMany.mockReset();
    viewFindMany.mockReset();
  });

  it("devuelve [] sin consultar prisma cuando no hay tareas", async () => {
    const result = await attachUnreadComments([], "user-1");
    expect(result).toEqual([]);
    expect(commentFindMany).not.toHaveBeenCalled();
    expect(viewFindMany).not.toHaveBeenCalled();
  });

  it("marca hasUnreadComments=true si hay un comentario de otro autor y nunca se vio la tarea", async () => {
    commentFindMany.mockResolvedValue([{ taskId: "t1", createdAt: new Date("2026-01-02T00:00:00Z") }]);
    viewFindMany.mockResolvedValue([]);

    const [result] = await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(result.hasUnreadComments).toBe(true);
  });

  it("marca hasUnreadComments=false si el último comentario es anterior a la última vista", async () => {
    commentFindMany.mockResolvedValue([{ taskId: "t1", createdAt: new Date("2026-01-01T00:00:00Z") }]);
    viewFindMany.mockResolvedValue([{ taskId: "t1", viewedAt: new Date("2026-01-02T00:00:00Z") }]);

    const [result] = await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(result.hasUnreadComments).toBe(false);
  });

  it("marca hasUnreadComments=true si hay un comentario posterior a la última vista", async () => {
    commentFindMany.mockResolvedValue([{ taskId: "t1", createdAt: new Date("2026-01-03T00:00:00Z") }]);
    viewFindMany.mockResolvedValue([{ taskId: "t1", viewedAt: new Date("2026-01-02T00:00:00Z") }]);

    const [result] = await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(result.hasUnreadComments).toBe(true);
  });

  it("marca hasUnreadComments=false si no hay comentarios de otros para la tarea", async () => {
    commentFindMany.mockResolvedValue([]);
    viewFindMany.mockResolvedValue([]);

    const [result] = await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(result.hasUnreadComments).toBe(false);
  });

  it("toma el comentario MÁS RECIENTE entre varios para decidir si hay no leídos", async () => {
    // El comentario más reciente es posterior a la vista, aunque uno anterior no lo sea.
    commentFindMany.mockResolvedValue([
      { taskId: "t1", createdAt: new Date("2026-01-01T00:00:00Z") },
      { taskId: "t1", createdAt: new Date("2026-01-05T00:00:00Z") },
    ]);
    viewFindMany.mockResolvedValue([{ taskId: "t1", viewedAt: new Date("2026-01-02T00:00:00Z") }]);

    const [result] = await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(result.hasUnreadComments).toBe(true);
  });

  it("calcula el estado de forma independiente por cada tarea", async () => {
    commentFindMany.mockResolvedValue([
      { taskId: "t1", createdAt: new Date("2026-01-05T00:00:00Z") },
      { taskId: "t2", createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    viewFindMany.mockResolvedValue([
      { taskId: "t1", viewedAt: new Date("2026-01-01T00:00:00Z") },
      { taskId: "t2", viewedAt: new Date("2026-01-02T00:00:00Z") },
    ]);

    const results = await attachUnreadComments([{ id: "t1" }, { id: "t2" }, { id: "t3" }], "user-1");
    expect(results.find((r) => r.id === "t1")?.hasUnreadComments).toBe(true);
    expect(results.find((r) => r.id === "t2")?.hasUnreadComments).toBe(false);
    expect(results.find((r) => r.id === "t3")?.hasUnreadComments).toBe(false);
  });

  it("excluye del cálculo los comentarios del propio usuario (authorId != userId en la consulta)", async () => {
    commentFindMany.mockResolvedValue([]);
    viewFindMany.mockResolvedValue([]);
    await attachUnreadComments([{ id: "t1" }], "user-1");
    expect(commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorId: { not: "user-1" } }),
      })
    );
  });
});
