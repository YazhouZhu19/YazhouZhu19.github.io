import { useRef, useState } from "react";
import { Database, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { exportBackup, importBackup, validateBackup, MAX_BACKUP_BYTES } from "@/lib/local-api";
import { useI18n } from "./locale-provider";
import { toast } from "sonner";

export function LocalDataControls({ onChange }: { onChange: () => Promise<unknown> }) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false), [pending, setPending] = useState<ReturnType<typeof validateBackup> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const backup = () => {
    try {
      const payload = exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `research-notes-${new Date().toISOString().slice(0,10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast.error(tr((error as Error).message)); }
  };
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><Database size={14}/>{tr("本机数据")}</Button><Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setPending(null); }}><DialogContent><DialogHeader><DialogTitle>{tr("个人数据与备份")}</DialogTitle><DialogDescription>{tr("收藏、笔记和团队名单仅保存在当前浏览器，不会上传到 GitHub，也不会跨设备自动同步。")}</DialogDescription></DialogHeader><p className="detail-hint">{tr("清除浏览器数据或使用隐私窗口可能丢失记录，请定期导出备份。公共论文库不包含个人资料，旧站账号数据不会自动转入。")}</p><div className="local-data-actions"><Button onClick={backup} variant="outline"><Download size={16}/>{tr("导出个人备份")}</Button><Button onClick={() => input.current?.click()} variant="outline"><Upload size={16}/>{tr("导入个人备份")}</Button><input ref={input} type="file" accept=".json,application/json" aria-label={tr("选择备份文件")} className="sr-only" onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error("备份文件过大"); setPending(validateBackup(JSON.parse(await file.text()))); }
    catch (error) { setPending(null); toast.error(tr(error instanceof SyntaxError ? "备份文件格式不正确" : (error as Error).message)); }
  }}/></div>{pending && <div className="local-import-confirm"><strong>{tr("确认恢复备份")}</strong><p>{tr("将用备份中的 {0} 条收藏和 {1} 份团队名单替换当前浏览器的数据。请先导出当前备份。",[pending.collections.length,pending.teams.length])}</p><DialogFooter><Button variant="outline" onClick={() => setPending(null)}>{tr("取消")}</Button><Button onClick={async () => { try { importBackup(pending); await onChange(); setPending(null); toast.success(tr("个人备份已恢复")); } catch (error) { toast.error(tr((error as Error).message)); } }}>{tr("确认替换本机数据")}</Button></DialogFooter></div>}</DialogContent></Dialog></>;
}
