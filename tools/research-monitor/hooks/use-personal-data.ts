import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, LOCAL_DATA_KEY, getLocalStorageStatus, type LocalStorageStatus } from "@/lib/local-api";
import type { Collection, Paper, Team } from "@/lib/types";
export function usePersonalData({
  papers,
  storageAvailable,
  onStorageStatus,
  tr,
}: {
  papers: Paper[];
  storageAvailable: boolean;
  onStorageStatus: (status: LocalStorageStatus) => void;
  tr: (key: string, values?: unknown[]) => string;
}) {
  const [collections, setCollections] = useState<Collection[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [selected, setSelected] = useState<Paper | null>(null),
    [note, setNote] = useState(""),
    [stage, setStage] = useState("待读"),
    [saving, setSaving] = useState(false);
  const refreshPersonal = useCallback(async () => {
    const local = getLocalStorageStatus();
    onStorageStatus(local);
    if (!local.readable) {
      setCollections([]);
      setTeams([]);
      return;
    }
    const settled = await Promise.allSettled([api("/api/collections"), api("/api/teams")]);
    if (settled[0].status === "fulfilled") setCollections(settled[0].value.collections);
    else toast.error(tr("收藏暂时无法读取"));
    if (settled[1].status === "fulfilled") setTeams(settled[1].value.teams);
    else toast.error(tr("关注名单暂时无法读取"));
  }, [tr, onStorageStatus]);

  useEffect(() => {
    void refreshPersonal();
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_DATA_KEY || event.key === null) void refreshPersonal();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshPersonal]);
  const savedIds = useMemo(() => new Set(collections.map((c) => c.paperId)), [collections]);
  const collectionById = useMemo(
    () => new Map(collections.map((collection) => [collection.paperId, collection])),
    [collections],
  );
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const openPaper = useCallback(
    (p: Paper) => {
      const original = paperById.get(p.id) ?? p;
      setSelected(original);
      const c = collectionById.get(original.id);
      setNote(c?.note ?? "");
      setStage(c?.stage ?? "待读");
    },
    [collectionById, paperById],
  );
  const savePaper = async (p: Paper, withNote = false) => {
    if (!storageAvailable) {
      toast.error(tr("存储暂时不可用，请稍后再试"));
      return;
    }
    setSaving(true);
    try {
      const existing = collectionById.get(p.id);
      await api("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          paperId: p.id,
          note: withNote ? note : (existing?.note ?? ""),
          stage: withNote ? stage : (existing?.stage ?? "待读"),
        }),
      });
      const d = await api("/api/collections");
      setCollections(d.collections);
      toast.success(withNote ? tr("笔记已保存") : tr("已加入选题收藏"));
    } catch (e) {
      toast.error(tr((e as Error).message));
    } finally {
      setSaving(false);
    }
  };
  const removePaper = async (p: Paper) => {
    try {
      await api("/api/collections", { method: "DELETE", body: JSON.stringify({ paperId: p.id }) });
      setCollections((c) => c.filter((x) => x.paperId !== p.id));
      toast.success(tr("已取消收藏"));
    } catch (e) {
      toast.error(tr((e as Error).message));
    }
  };

  return {
    collections,
    teams,
    selected,
    setSelected,
    note,
    setNote,
    stage,
    setStage,
    saving,
    savedIds,
    collectionById,
    refreshPersonal,
    openPaper,
    savePaper,
    removePaper,
  };
}
export type PersonalDataState = ReturnType<typeof usePersonalData>;
