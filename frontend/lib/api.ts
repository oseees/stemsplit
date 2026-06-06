const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Job {
  id: string;
  status: "queued" | "uploading" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  stems?: {
    vocals: string;
    drums: string;
    bass: string;
    other: string;
    zip: string;
  };
  filename?: string;
  created_at?: string;
  error?: string;
}

export async function uploadAudio(file: File): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startSeparation(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/separate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/status/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function getDownloadUrl(jobId: string, stem: string): string {
  return `${API_BASE}/download/${jobId}/${stem}`;
}

export async function getHistory(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/history`);
  if (!res.ok) return [];
  return res.json();
}

// ---------- Payments ----------

export interface PaymentConfig {
  configured: boolean;
  client_id: string;
  mode: "sandbox" | "live";
  price: string;
  currency: string;
}

export async function getPaymentConfig(): Promise<PaymentConfig> {
  const res = await fetch(`${API_BASE}/payments/config`);
  if (!res.ok) throw new Error("Failed to load payment config");
  return res.json();
}

export async function createPayPalOrder(): Promise<string> {
  const res = await fetch(`${API_BASE}/payments/create-order`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).order_id;
}

export async function capturePayPalOrder(orderId: string): Promise<{ status: string; license: string }> {
  const res = await fetch(`${API_BASE}/payments/capture-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function verifyLicense(license: string): Promise<{ valid: boolean; plan: string }> {
  const res = await fetch(`${API_BASE}/payments/verify/${license}`);
  if (!res.ok) return { valid: false, plan: "free" };
  return res.json();
}

// Local Pro state (MVP — stored client-side; backend issues the license on payment)
export const PRO_KEY = "stemsplit_pro_license";

export function getStoredLicense(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PRO_KEY);
}

export function setStoredLicense(license: string) {
  localStorage.setItem(PRO_KEY, license);
}

export function isProUser(): boolean {
  return !!getStoredLicense();
}

export function clearLicense() {
  localStorage.removeItem(PRO_KEY);
}

// Re-checks the stored license against the backend; clears it if revoked/invalid.
export async function refreshProStatus(): Promise<boolean> {
  const license = getStoredLicense();
  if (!license) return false;
  const { valid } = await verifyLicense(license);
  if (!valid) clearLicense();
  return valid;
}
