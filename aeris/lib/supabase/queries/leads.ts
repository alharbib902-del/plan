import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  LeadInquiryInsert,
  LeadInquiryRow,
  LeadStatus,
} from '@/types/database';
import { LEAD_STATUSES } from '@/lib/validators/admin';

const TABLE = 'lead_inquiries';

export interface ListLeadsParams {
  status?: LeadStatus | 'all';
  limit?: number;
  offset?: number;
}

export interface LeadStatusCounts {
  total: number;
  new: number;
  contacted: number;
  quoted: number;
  converted: number;
  closed: number;
}

export async function listLeads(
  params: ListLeadsParams = {}
): Promise<LeadInquiryRow[]> {
  noStore();
  const { status, limit = 100, offset = 0 } = params;
  const client = createAdminClient();

  let query = client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[leads] listLeads failed', error);
    throw new Error(`listLeads failed: ${error.message}`);
  }
  return (data ?? []) as LeadInquiryRow[];
}

export async function countLeadsByStatus(): Promise<LeadStatusCounts> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('status', { count: 'exact', head: false });

  if (error) {
    console.error('[leads] countLeadsByStatus failed', error);
    throw new Error(`countLeadsByStatus failed: ${error.message}`);
  }

  const counts: LeadStatusCounts = {
    total: 0,
    new: 0,
    contacted: 0,
    quoted: 0,
    converted: 0,
    closed: 0,
  };
  for (const row of data ?? []) {
    counts.total += 1;
    const s = (row as { status: LeadStatus }).status;
    if (LEAD_STATUSES.includes(s)) counts[s] += 1;
  }
  return counts;
}

export async function getLeadById(id: string): Promise<LeadInquiryRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[leads] getLeadById failed', error);
    throw new Error(`getLeadById failed: ${error.message}`);
  }
  return (data as LeadInquiryRow | null) ?? null;
}

export interface InsertLeadResult {
  id: string;
  requestNumber: string;
  row: LeadInquiryRow;
}

export async function insertLead(
  input: LeadInquiryInsert
): Promise<InsertLeadResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .insert(input)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `insertLead failed: ${error?.message ?? 'no row returned'}`
    );
  }
  const row = data as LeadInquiryRow;
  return { id: row.id, requestNumber: row.request_number, row };
}

export async function updateLeadStatus(
  id: string,
  status: LeadStatus
): Promise<LeadInquiryRow> {
  noStore();
  const client = createAdminClient();

  const patch: { status: LeadStatus; last_contacted_at?: string } = {
    status,
  };
  if (status !== 'new') {
    patch.last_contacted_at = new Date().toISOString();
  }

  const { data, error } = await client
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `updateLeadStatus failed: ${error?.message ?? 'no row returned'}`
    );
  }
  return data as LeadInquiryRow;
}

export async function appendInternalNote(
  id: string,
  note: string
): Promise<LeadInquiryRow> {
  noStore();
  const client = createAdminClient();

  const existing = await getLeadById(id);
  if (!existing) {
    throw new Error(`appendInternalNote: lead not found (${id})`);
  }

  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${note.trim()}`;
  const next = existing.internal_notes
    ? `${existing.internal_notes}\n${entry}`
    : entry;

  const { data, error } = await client
    .from(TABLE)
    .update({ internal_notes: next })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `appendInternalNote failed: ${error?.message ?? 'no row returned'}`
    );
  }
  return data as LeadInquiryRow;
}
