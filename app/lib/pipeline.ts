export interface PipelineEntry {
  leadId: number;
  userName: string;
  product: string;
  pain: string;
  summary: string;
  stage: "agreed" | "followup" | "closed";
  closedResult?: "paid" | "refused";
  note: string;
  followUpDate: string; // "YYYY-MM-DD"
  amount: string;
  addedAt: number;
  updatedAt: number;
}

const KEY = "vk_pipeline";

export function loadPipeline(): PipelineEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PipelineEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePipeline(entries: PipelineEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {}
}

export function addToPipeline(entry: PipelineEntry): void {
  const entries = loadPipeline();
  const existing = entries.findIndex(e => e.leadId === entry.leadId);
  if (existing >= 0) {
    entries[existing] = { ...entries[existing], ...entry, updatedAt: Date.now() };
  } else {
    entries.unshift(entry);
  }
  savePipeline(entries);
}

export function updatePipelineEntry(leadId: number, updates: Partial<PipelineEntry>): void {
  const entries = loadPipeline();
  const idx = entries.findIndex(e => e.leadId === leadId);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...updates, updatedAt: Date.now() };
    savePipeline(entries);
  }
}

export function removeFromPipeline(leadId: number): void {
  savePipeline(loadPipeline().filter(e => e.leadId !== leadId));
}
