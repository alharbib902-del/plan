import 'server-only';

import { createLooseClient } from '@/lib/supabase/loose-query';

export type SupportTicketRow = {
  id: string;
  ticket_number: string;
  client_id: string;
  booking_id: string | null;
  category: string;
  priority: string;
  subject: string;
  description: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketMessageRow = {
  id: string;
  ticket_id: string;
  author_role: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

const TICKET_COLUMNS =
  'id, ticket_number, client_id, booking_id, category, priority, subject, description, status, resolution, resolved_at, created_at, updated_at';

/** Tickets opened by a client (clients.id), newest activity first. */
export async function getTicketsForClient(clientId: string): Promise<SupportTicketRow[]> {
  const { data, error } = await createLooseClient()
    .from('support_tickets')
    .select(TICKET_COLUMNS)
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as SupportTicketRow[];
}

/** A single ticket scoped to its owning client (null if not owned / not found). */
export async function getTicketForClient(
  ticketId: string,
  clientId: string
): Promise<SupportTicketRow | null> {
  const { data, error } = await createLooseClient()
    .from('support_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', ticketId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? null) as SupportTicketRow | null;
}

/** All tickets (admin view), newest activity first. */
export async function getAllTickets(): Promise<SupportTicketRow[]> {
  const { data, error } = await createLooseClient()
    .from('support_tickets')
    .select(TICKET_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as SupportTicketRow[];
}

/** A single ticket without owner scoping (admin view). */
export async function getTicketById(ticketId: string): Promise<SupportTicketRow | null> {
  const { data, error } = await createLooseClient()
    .from('support_tickets')
    .select(TICKET_COLUMNS)
    .eq('id', ticketId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? null) as SupportTicketRow | null;
}

/** The conversation thread for a ticket, oldest first. */
export async function getTicketMessages(
  ticketId: string
): Promise<SupportTicketMessageRow[]> {
  const { data, error } = await createLooseClient()
    .from('support_ticket_messages')
    .select('id, ticket_id, author_role, author_id, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as SupportTicketMessageRow[];
}
